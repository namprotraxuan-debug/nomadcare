/*
 * secure.js — at-rest encryption for sensitive local data (medical profile, device secret).
 * AES-GCM-256 with a NON-extractable CryptoKey generated once and kept in IndexedDB kv 'secure.key'
 * (structured clone of CryptoKey — the raw key never leaves the browser's crypto engine).
 * Fallback (no crypto.subtle / no IndexedDB / key not storable): base64 JSON with enc:false and
 * NC.secure.encrypted = false (Settings shows a warning). Owner: P1 shell.
 * Public API: NC.secure.{ready() → Promise<bool>, save(name, obj), load(name) → obj|null, remove(name), wipe(), encrypted,
 *                        seal(obj) → Promise<sealed>, unseal(sealed) → Promise<obj|null>}
 */
(function (NC) {
  'use strict';

  var KEY_NAME = 'secure.key';
  var subtle = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
  var readyPromise = null;
  var cryptoKey = null;

  var api = {
    // Provisional value; finalised by ready().
    encrypted: !!(subtle && window.indexedDB)
  };

  function table() { return NC.store.table('secure'); }

  /* ---------- base64 helpers (UTF-8 safe) ---------- */
  function bytesToB64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function encodeUtf8(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)); var a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function decodeUtf8(buf) {
    if (window.TextDecoder) return new TextDecoder().decode(buf);
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return decodeURIComponent(escape(s));
  }

  function isCryptoKey(k) {
    return !!k && typeof k === 'object' && !!k.algorithm && k.type === 'secret';
  }

  /**
   * Resolve the encryption key (load or create). Resolves true when real encryption is active.
   */
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = NC.store.ready().then(function () {
      if (!subtle || NC.store.backend !== 'idb') return false;
      return NC.store.get(KEY_NAME).then(function (k) {
        if (isCryptoKey(k)) { cryptoKey = k; return true; }
        return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
          return NC.store.set(KEY_NAME, nk).then(function () { cryptoKey = nk; return true; });
        });
      });
    }).then(function (ok) {
      api.encrypted = !!ok;
      return api.encrypted;
    }, function (err) {
      console.warn('[secure] encryption unavailable — storing without encryption', err && err.name);
      api.encrypted = false;
      cryptoKey = null;
      return false;
    });
    return readyPromise;
  }

  /** Encrypt and store `obj` under `name`. */
  function save(name, obj) {
    return ready().then(function (enc) {
      var json = JSON.stringify(obj === undefined ? null : obj);
      var now = new Date().toISOString();
      if (!enc || !cryptoKey) {
        return table().put({ id: name, v: 1, enc: false, data: bytesToB64(encodeUtf8(json)), updated_at: now });
      }
      var iv = window.crypto.getRandomValues(new Uint8Array(12));
      return subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, encodeUtf8(json)).then(function (ct) {
        return table().put({ id: name, v: 1, enc: true, alg: 'AES-GCM-256', iv: bytesToB64(iv), data: bytesToB64(ct), updated_at: now });
      });
    }).then(function () { return true; });
  }

  /** Load and decrypt `name` → object or null (missing / undecryptable). */
  function load(name) {
    return ready().then(function () {
      return table().get(name);
    }).then(function (rec) {
      if (!rec) return null;
      if (!rec.enc) {
        try { return JSON.parse(decodeUtf8(b64ToBytes(rec.data))); } catch (e) { return null; }
      }
      if (!cryptoKey) return null;
      return subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(rec.iv) }, cryptoKey, b64ToBytes(rec.data)).then(function (pt) {
        return JSON.parse(decodeUtf8(pt));
      }, function () {
        console.warn('[secure] could not decrypt "' + name + '" (key changed?)');
        return null;
      });
    });
  }

  function remove(name) { return table().delete(name); }

  /**
   * Encrypt a small object for storage INSIDE another record (e.g. the Buddy contact inside the session / outbox op).
   * @returns {Promise<{sealed:1, enc:boolean, alg?, iv?, data:string}>}
   */
  function seal(obj) {
    return ready().then(function (enc) {
      var json = JSON.stringify(obj === undefined ? null : obj);
      if (!enc || !cryptoKey) return { sealed: 1, enc: false, data: bytesToB64(encodeUtf8(json)) };
      var iv = window.crypto.getRandomValues(new Uint8Array(12));
      return subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, encodeUtf8(json)).then(function (ct) {
        return { sealed: 1, enc: true, alg: 'AES-GCM-256', iv: bytesToB64(iv), data: bytesToB64(ct) };
      });
    });
  }

  /** Reverse of seal() → object, or null (not a sealed value / key shredded / tampered). */
  function unseal(rec) {
    if (!rec || rec.sealed !== 1 || typeof rec.data !== 'string') return Promise.resolve(null);
    return ready().then(function () {
      if (!rec.enc) {
        try { return JSON.parse(decodeUtf8(b64ToBytes(rec.data))); } catch (e) { return null; }
      }
      if (!cryptoKey) return null;
      return subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(rec.iv) }, cryptoKey, b64ToBytes(rec.data)).then(function (pt) {
        return JSON.parse(decodeUtf8(pt));
      }, function () { return null; });
    }).catch(function () { return null; });
  }

  /** Delete every secure record AND the key (crypto-shredding). A new key is created on next use. */
  function wipe() {
    return table().clear().then(function () {
      return NC.store.del(KEY_NAME);
    }).then(function () {
      cryptoKey = null; readyPromise = null;
      return true;
    });
  }

  api.ready = ready;
  api.save = save;
  api.load = load;
  api.remove = remove;
  api.seal = seal;
  api.unseal = unseal;
  api.wipe = wipe;
  NC.secure = api;
})(window.NC = window.NC || {});
