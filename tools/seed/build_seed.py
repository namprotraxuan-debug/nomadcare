#!/usr/bin/env python3
"""NomadCare v2 — illustrative seed dataset builder (owner: P1 seed; Python 3 stdlib only).

Outputs (contract §10):
  assets/js/data/seed-core.js   window.NC_SEED        routes/graph/segments/accuracy/facilities/...
  assets/js/data/seed-admin.js  window.NC_SEED_ADMIN  samples/devices/buddy sessions/events/audit
  supabase/seed.sql             idempotent load of the same data into the Supabase schema (§9)

Usage:
  python3 tools/seed/build_seed.py            build (network only for URLs missing from tools/seed/cache/)
  python3 tools/seed/build_seed.py --offline  build strictly from the cache
  python3 tools/seed/build_seed.py --check    validate the generated files and print a summary table
Deterministic: fixed RNG seed, fixed build timestamp, cached HTTP responses.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # keep tools/seed/ free of __pycache__

import geo  # noqa: E402
import graph  # noqa: E402
import signal_model as sm  # noqa: E402
from defs_admin import (AUDIT, COMMUNITY_SAMPLES, CONTENT_RELEASES, DEVICES, SESSIONS,  # noqa: E402
                        SUBMISSIONS)
from defs_pois import (FACILITIES, NOTE_COMMISSION, NOTE_ESSENTIAL, NOTE_LODGING_PARTNER,  # noqa: E402
                       SERVICES, VERIFY_SUFFIX)
from defs_routes import CARRIERS  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_CORE = os.path.join(ROOT, 'assets', 'js', 'data', 'seed-core.js')
OUT_ADMIN = os.path.join(ROOT, 'assets', 'js', 'data', 'seed-admin.js')
OUT_SQL = os.path.join(ROOT, 'supabase', 'seed.sql')

RNG_SEED = 20260927
MODEL_VERSION = 'idw-0.3-demo'
TZ = dt.timezone(dt.timedelta(hours=7))
ANCHOR = dt.datetime(2026, 9, 27, 10, 0, 0, tzinfo=TZ)      # reference "now" of the demo scenario
BUILT_AT = dt.datetime(2026, 9, 27, 8, 0, 0, tzinfo=TZ)     # fixed => reproducible output
STALE_BEFORE = (ANCHOR - dt.timedelta(days=90)).date()     # 2026-06-29
PACK_PUBLISHED = ANCHOR - dt.timedelta(minutes=780)
UUID_NS = uuid.UUID('6f1c7a52-9d7e-4d53-9a44-2b1e0c0a5eed')
ROUTE_PREFIX = {'khanh-le': 'kl', 'ta-nang-phan-dung': 'tn', 'ha-giang-loop': 'hg'}
SPEEDS = {'motorbike': 25.0, 'hiking': 3.5}                 # km/h — same as NC.routing.SPEEDS (contract §8)

# Survey timelines (PDF §6.3: Khánh Lê & Tà Năng measured first and repeated; Hà Giang one trip).
TRIPS = {
    'khanh-le': {'start': (2026, 7, 18, 7, 30), 'speed': 32.0, 'day': (7.5, 17.5), 'overrides': {}},
    'ta-nang-phan-dung': {'start': (2026, 8, 1, 6, 30), 'speed': 2.4, 'day': (6.5, 17.0),
                          'overrides': {'tn-e10': ((2026, 8, 15, 7, 10), 2.4), 'tn-e12': ((2026, 8, 2, 15, 30), 30.0)}},
    'ha-giang-loop': {'start': (2026, 8, 20, 7, 30), 'speed': 28.0, 'day': (7.5, 17.0), 'overrides': {}},
}

CORE_KEYS = ['schema', 'notice', 'generated_at', 'model_version', 'carriers', 'routes', 'nodes', 'edges', 'segments',
             'accuracy', 'facilities', 'services', 'submissions', 'content_releases', 'packs']
ADMIN_KEYS = ['schema', 'generated_at', 'anchor_at', 'samples', 'devices', 'buddy_sessions', 'checkin_events', 'audit']
FIELDS = {
    'route': ['id', 'name', 'name_en', 'region', 'region_en', 'travel_mode', 'length_km', 'color', 'bbox', 'description_vi',
              'description_en', 'sort', 'is_active', 'geometry'],
    'node': ['id', 'route_id', 'name', 'name_en', 'kind', 'lat', 'lng'],
    'edge': ['id', 'route_id', 'from', 'to', 'length_km', 'is_connector', 'geometry'],
    'segment': ['route_id', 'carrier', 'edge_id', 'seq', 'from_km', 'to_km', 'level', 'confidence'],
    'accuracy': ['route_id', 'carrier', 'accuracy', 'holdout_n', 'model_version', 'computed_at'],
    'facility': ['id', 'route_id', 'name', 'type', 'address', 'lat', 'lng', 'phone', 'open_hours', 'night_shift',
                 'trauma_capable', 'verified_by', 'verified_at', 'status', 'source', 'notes', 'is_demo',
                 'created_at', 'updated_at'],
    'service': ['id', 'route_id', 'name', 'type', 'lat', 'lng', 'phone', 'open_hours', 'is_partner',
                'commission_rate', 'status', 'notes', 'is_demo', 'created_at', 'updated_at'],
    'submission': ['id', 'device_id', 'facility_id', 'kind', 'payload', 'lat', 'lng', 'status', 'review_note',
                   'reviewed_by', 'reviewed_at', 'created_at', 'offset_min'],
    'content_release': ['id', 'version', 'kind', 'status', 'notes', 'reviewer_round1', 'approver', 'approved_at',
                        'created_at'],
    'pack': ['route_id', 'carrier', 'version', 'published_at', 'notes'],
    'sample': ['id', 'route_id', 'edge_id', 'carrier', 'tech', 'rsrp_dbm', 'level', 'lat', 'lng', 'measured_at',
               'source', 'status', 'device_model', 'is_holdout'],
    'device': ['id', 'secret_hash', 'carrier', 'app_version', 'created_at', 'last_seen_at', 'offset_min'],
    'session': ['id', 'device_id', 'traveler_name', 'recipient_name', 'recipient_email', 'recipient_phone',
                'interval_min', 'grace_min', 'route_id', 'travel_mode', 'share_public_medical', 'public_medical',
                'status', 'started_at', 'last_checkin_at', 'next_due_at', 'last_lat', 'last_lng', 'last_location_at',
                'alerted_at', 'closed_at', 'created_at', 'updated_at', 'offset_min'],
    'event': ['id', 'session_id', 'device_id', 'kind', 'lat', 'lng', 'accuracy_m', 'client_ts', 'received_at',
              'queued', 'note', 'meta', 'offset_min'],
    'audit': ['id', 'actor', 'actor_label', 'action', 'entity', 'entity_id', 'details', 'created_at', 'offset_min'],
}
REQUIRED_VERIFIED = ['name', 'address', 'lat', 'lng', 'type', 'open_hours', 'night_shift', 'trauma_capable', 'phone',
                     'verified_by', 'verified_at']
PHONE_RE = re.compile(r'^\+84 000 000 0\d\d$')


# ------------------------------------------------------------------------------------------ helpers
def iso(t):
    return t.isoformat(timespec='seconds')


def at_offset(minutes):
    return ANCHOR + dt.timedelta(minutes=minutes)


def did(key):
    """Deterministic UUID for a seed key."""
    return str(uuid.uuid5(UUID_NS, key))


def demo_phone(n):
    return '+84 000 000 0%02d' % n


class Resolver:
    """Turns anchors from the defs_* modules into coordinates on the snapped graph.

    Anchor forms: ('ll', lat, lng) | ('node', id[, north_m, east_m]) | ('edge', from, to, frac[, side_m])
    | ('dz', [node ids in travel order], delta_km) — relative to the first 'lost' run along that path for
    the carrier given to point() (negative delta = before the dead zone). Needs segments (set_segments).
    """

    def __init__(self, built):
        self.nodes = {}
        self.edges = {}
        self.segs = {}
        for r in built:
            for n in r['nodes']:
                self.nodes[n['id']] = n
            for e in r['edges']:
                self.edges[(e['from'], e['to'])] = e

    def set_segments(self, segments):
        self.segs = {}
        for g in segments:
            self.segs.setdefault((g['edge_id'], g['carrier']), []).append(g)
        for v in self.segs.values():
            v.sort(key=lambda g: g['seq'])

    def edge(self, a, b):
        e = self.edges.get((a, b))
        if not e:
            raise KeyError('no edge %s -> %s' % (a, b))
        return e

    def chain(self, path):
        """[(edge, reversed)] for consecutive node ids of a travel path (edges may be walked backwards)."""
        out = []
        for a, b in zip(path, path[1:]):
            if (a, b) in self.edges:
                out.append((self.edges[(a, b)], False))
            elif (b, a) in self.edges:
                out.append((self.edges[(b, a)], True))
            else:
                raise KeyError('no edge between %s and %s' % (a, b))
        return out

    def runs_along(self, path, carrier):
        """Signal runs [(from_km, to_km, level)] measured along the travel path, adjacent equal levels merged."""
        runs, base = [], 0.0
        for e, rev in self.chain(path):
            L = e['length_km']
            segs = self.segs[(e['id'], carrier)]
            part = [(L - g['to_km'], L - g['from_km'], g['level']) for g in reversed(segs)] if rev else \
                   [(g['from_km'], g['to_km'], g['level']) for g in segs]
            for k0, k1, lvl in part:
                if runs and runs[-1][2] == lvl:
                    runs[-1] = (runs[-1][0], base + k1, lvl)
                else:
                    runs.append((base + k0, base + k1, lvl))
            base += L
        return runs

    def deadzone(self, path, carrier):
        """(start_km, length_km) of the first contiguous 'lost' stretch along the path."""
        for k0, k1, lvl in self.runs_along(path, carrier):
            if lvl == 'lost':
                return k0, k1 - k0
        raise ValueError('no lost run along %s for %s' % (path, carrier))

    def point_along(self, path, km):
        base = 0.0
        chain = self.chain(path)
        for i, (e, rev) in enumerate(chain):
            L = e['length_km']
            if km <= base + L or i == len(chain) - 1:
                local = min(L, max(0.0, km - base))
                line = [tuple(p) for p in e['geometry']]
                return geo.point_at(line, L - local if rev else local)
            base += L

    def point(self, anchor, carrier=None):
        kind = anchor[0]
        if kind == 'll':
            return anchor[1], anchor[2]
        if kind == 'dz':
            start, _ = self.deadzone(anchor[1], carrier)
            return self.point_along(anchor[1], max(0.0, start + anchor[2]))
        if kind == 'node':
            n = self.nodes[anchor[1]]
            north, east = (anchor[2], anchor[3]) if len(anchor) > 2 else (0, 0)
            return geo.offset_point((n['lat'], n['lng']), north, east)
        if kind == 'edge':
            e = self.edge(anchor[1], anchor[2])
            line = [tuple(p) for p in e['geometry']]
            km = e['length_km'] * anchor[3]
            p = geo.point_at(line, km)
            side = anchor[4] if len(anchor) > 4 else 0
            if side:
                dn, de = geo.bearing_at(line, km)
                p = geo.offset_point(p, de * side, -dn * side)  # left of travel direction
            return p
        raise ValueError(anchor)

    def along(self, anchor):
        """(edge, km) of an edge anchor; for node anchors the first incident edge at km 0/len."""
        if anchor[0] == 'edge':
            e = self.edge(anchor[1], anchor[2])
            return e, e['length_km'] * anchor[3]
        nid = anchor[1]
        for (a, b), e in self.edges.items():
            if a == nid:
                return e, 0.0
            if b == nid:
                return e, e['length_km']
        raise KeyError(nid)


def add_active_time(start, hours, day):
    """Advance a clock by `hours` of active survey time, only inside the daily window day=(h0, h1)."""
    t = start
    remaining = hours
    h0, h1 = day
    while remaining > 1e-9:
        day_end = t.replace(hour=int(h1), minute=int(round((h1 % 1) * 60)), second=0)
        if t >= day_end:
            nxt = (t + dt.timedelta(days=1)).replace(hour=int(h0), minute=int(round((h0 % 1) * 60)), second=0)
            t = nxt
            continue
        avail = (day_end - t).total_seconds() / 3600.0
        step = min(avail, remaining)
        t += dt.timedelta(hours=step)
        remaining -= step
    return t


def make_trip(route_id, edges):
    cfg = TRIPS[route_id]
    clock = dt.datetime(*cfg['start'], tzinfo=TZ)
    speed = cfg['speed']
    starts = {}
    for e in edges:
        if e['id'] in cfg['overrides']:
            o = cfg['overrides'][e['id']]
            clock = dt.datetime(*o[0], tzinfo=TZ)
            speed = o[1]
        starts[e['id']] = (clock, speed)
        clock = add_active_time(clock, e['length_km'] / speed + 0.25, cfg['day'])  # +15 min stop per edge

    def trip(edge, km):
        t0, v = starts[edge['id']]
        return iso(add_active_time(t0, km / v, cfg['day']))
    return trip


# ------------------------------------------------------------------------------------------ build
def build_pois(built, res, rng):
    facilities, services = [], []
    fphone = 10
    fresh_pool = [dt.date(2026, 8, 3) + dt.timedelta(days=i) for i in range(0, 53)]      # 03/08 .. 24/09
    stale_pool = [dt.date(2026, 4, 6) + dt.timedelta(days=i) for i in range(0, 80)]      # 06/04 .. 24/06
    for r in built:
        rid = r['route']['id']
        pre = ROUTE_PREFIX[rid]
        for i, f in enumerate(FACILITIES[rid]):
            lat, lng = res.point(f['at'])
            st = f['st']
            status = {'v': 'verified', 'vs': 'verified', 'p': 'pending', 'r': 'rejected'}[st]
            missing = set(f.get('missing', []))
            if status == 'verified':
                vdate = rng.choice(stale_pool if st == 'vs' else fresh_pool)
            elif status == 'rejected':
                vdate = rng.choice(fresh_pool)
            else:
                vdate = None
            created = dt.datetime.combine((vdate or rng.choice(fresh_pool)) - dt.timedelta(days=rng.randint(3, 30)),
                                          dt.time(9, rng.randint(0, 59)), TZ)
            updated = dt.datetime.combine(vdate, dt.time(rng.randint(8, 16), rng.randint(0, 59)), TZ) if vdate else created
            if 'phone' in missing:
                phone = None
            else:
                phone = demo_phone(fphone)
                fphone += 1
            who = f.get('who')
            verified_by = None
            if status == 'verified' and who:
                verified_by = who + VERIFY_SUFFIX
            elif status == 'rejected':
                verified_by = 'Nhóm Stormbreakers (gọi xác minh — không đạt)'
            rec = {
                'id': 'fac-%s-%02d' % (pre, i + 1), 'route_id': rid, 'name': f['name'], 'type': f['type'],
                'address': f['address'], 'lat': round(lat, 6), 'lng': round(lng, 6), 'phone': phone,
                'open_hours': None if 'open_hours' in missing else f.get('hours'),
                'night_shift': None if 'night_shift' in missing else f.get('night'),
                'trauma_capable': None if 'trauma_capable' in missing else f.get('trauma'),
                'verified_by': None if 'verified_by' in missing else verified_by,
                'verified_at': None if ('verified_at' in missing or not vdate) else vdate.isoformat(),
                'status': status, 'source': f.get('source', 'team'), 'notes': f.get('notes'),
                'is_demo': True, 'created_at': iso(created), 'updated_at': iso(updated),
            }
            facilities.append(rec)
        sphone = 80
        for i, (name, typ, at, hours, partner, extra, status) in enumerate(SERVICES[rid]):
            lat, lng = res.point(at)
            if partner:
                note = NOTE_LODGING_PARTNER if typ == 'lodging' else NOTE_COMMISSION
                rate = 0.0 if typ == 'lodging' else 0.08
            else:
                note, rate = NOTE_ESSENTIAL, 0.0
            if extra:
                note = extra + ' ' + note
            created = dt.datetime(2026, 8, 1, 9, 0, tzinfo=TZ) + dt.timedelta(days=rng.randint(0, 40), minutes=rng.randint(0, 500))
            services.append({
                'id': 'svc-%s-%02d' % (pre, i + 1), 'route_id': rid, 'name': name, 'type': typ,
                'lat': round(lat, 6), 'lng': round(lng, 6), 'phone': demo_phone(sphone), 'open_hours': hours,
                'is_partner': partner, 'commission_rate': rate, 'status': status, 'notes': note, 'is_demo': True,
                'created_at': iso(created), 'updated_at': iso(created + dt.timedelta(days=rng.randint(0, 14))),
            })
            sphone += 1
    return facilities, services


def build_signal(built, rng):
    counter = [0]

    def next_id():
        counter[0] += 1
        return counter[0]

    samples, segments, accuracy, envs = [], [], [], {}
    for r in built:
        trip = make_trip(r['route']['id'], r['edges'])
        ss, env = sm.survey(r['route'], r['nodes'], r['edges'], trip, rng, next_id)
        envs[r['route']['id']] = env
        segs, acc = sm.model_route(r['route'], r['edges'], ss)
        samples.extend(ss)
        segments.extend(segs)
        for a in acc:
            a.update({'model_version': MODEL_VERSION, 'computed_at': iso(BUILT_AT)})
        accuracy.extend(acc)
    return samples, segments, accuracy, envs, next_id


def build_community_samples(res, envs, rng, next_id):
    out = []
    for (rid, a, b, fracs, carrier, dev, off) in COMMUNITY_SAMPLES:
        e = res.edge(a, b)
        line = [tuple(p) for p in e['geometry']]
        for j, f in enumerate(fracs):
            km = e['length_km'] * f
            p = geo.point_at(line, km)
            tech, val = envs[rid].measure(e, km, p, carrier, rng.gauss(0, 5.0))
            q = geo.offset_point(p, rng.gauss(0, 8), rng.gauss(0, 8))
            out.append({
                'id': next_id(), 'route_id': rid, 'edge_id': e['id'], 'carrier': carrier, 'tech': tech,
                'rsrp_dbm': val, 'level': sm.level_of(val), 'lat': round(q[0], 6), 'lng': round(q[1], 6),
                'measured_at': iso(at_offset(off + j * 3)), 'source': 'community', 'status': 'pending',
                'device_model': 'Android · cộng đồng · demo', 'is_holdout': False, '_along': km, '_device': dev,
            })
    return out


def build_admin(res, facilities):
    devices = []
    for key, carrier, ver, c_off, s_off in DEVICES:
        devices.append({'id': did(key), 'secret_hash': hashlib.sha256(('demo-secret:' + key).encode()).hexdigest(),
                        'carrier': carrier, 'app_version': ver, 'created_at': iso(at_offset(c_off)),
                        'last_seen_at': iso(at_offset(s_off)), 'offset_min': {'created_at': c_off, 'last_seen_at': s_off}})
    dev_id = {k[0]: did(k[0]) for k in DEVICES}
    dev_carrier = {k[0]: k[1] for k in DEVICES}
    sessions, events = [], []
    for s in SESSIONS:
        sid = did(s['key'])
        carrier = dev_carrier[s['device']]
        last_ck = None
        last_loc = None
        alerted = closed = None
        for idx, (kind, off, pos, extra) in enumerate(s['events']):
            lat, lng = res.point(pos, carrier)
            rx = extra.get('rx', off)
            if kind == 'pre_deadzone' and pos[0] == 'dz':
                # warning metadata derived from the published segments, as MOD.04 would compute it
                _, dz_len = res.deadzone(pos[1], carrier)
                before = -pos[2]
                extra = dict(extra)
                extra['meta'] = {'minutes_to_deadzone': int(round(before / SPEEDS[s['travel_mode']] * 60)),
                                 'distance_km': round(before, 1), 'deadzone_km': round(dz_len, 1),
                                 'basis': 'time' if s['travel_mode'] == 'motorbike' else 'distance',
                                 'carrier': carrier}
                extra['note'] = 'Sắp vào vùng mất sóng ~%s km (%s)' % (
                    ('%.1f' % dz_len).replace('.', ','), extra.pop('label'))
            if kind in ('start', 'checkin'):
                last_ck = off
            if kind in ('start', 'checkin', 'location', 'pre_deadzone', 'sos', 'stop'):
                last_loc = (off, lat, lng)
            if kind == 'alert_sent':
                alerted = off
            if kind == 'stop':
                closed = off
            server = bool(extra.get('server'))
            events.append({
                'id': did('%s:ev%02d' % (s['key'], idx)), 'session_id': sid, 'device_id': dev_id[s['device']],
                'kind': kind, 'lat': round(lat, 6), 'lng': round(lng, 6),
                'accuracy_m': None if server else extra.get('accuracy_m', 12 + (idx * 7) % 20),
                'client_ts': iso(at_offset(off)), 'received_at': iso(at_offset(rx)),
                'queued': bool(extra.get('queued')), 'note': extra.get('note'), 'meta': extra.get('meta'),
                'offset_min': {'client_ts': off, 'received_at': rx},
            })
        start_off = s['events'][0][1]
        next_due = last_ck + s['interval_min']
        offs = {'started_at': start_off, 'last_checkin_at': last_ck, 'next_due_at': next_due,
                'last_location_at': last_loc[0], 'created_at': start_off,
                'updated_at': max(e[1] for e in s['events'])}
        if alerted is not None:
            offs['alerted_at'] = alerted
        if closed is not None:
            offs['closed_at'] = closed
        rec = {'id': sid, 'device_id': dev_id[s['device']]}
        for k in ('traveler_name', 'recipient_name', 'recipient_email', 'recipient_phone', 'interval_min', 'grace_min',
                  'route_id', 'travel_mode', 'share_public_medical', 'public_medical', 'status'):
            rec[k] = s[k]
        rec.update({'started_at': iso(at_offset(offs['started_at'])), 'last_checkin_at': iso(at_offset(last_ck)),
                    'next_due_at': iso(at_offset(next_due)), 'last_lat': round(last_loc[1], 6),
                    'last_lng': round(last_loc[2], 6), 'last_location_at': iso(at_offset(last_loc[0])),
                    'alerted_at': iso(at_offset(alerted)) if alerted is not None else None,
                    'closed_at': iso(at_offset(closed)) if closed is not None else None,
                    'created_at': iso(at_offset(start_off)), 'updated_at': iso(at_offset(offs['updated_at'])),
                    'offset_min': offs})
        sessions.append(rec)
    fac_by_name = {(f['route_id'], f['name']): f['id'] for f in facilities}
    submissions = []
    for s in SUBMISSIONS:
        fid = fac_by_name[s['facility']] if 'facility' in s else None
        if 'at' in s:
            lat, lng = res.point(s['at'])
        else:
            f = [x for x in facilities if x['id'] == fid][0]
            lat, lng = f['lat'], f['lng']
        submissions.append({'id': s['key'], 'device_id': dev_id[s['device']], 'facility_id': fid, 'kind': s['kind'],
                            'payload': s['payload'], 'lat': round(lat, 6), 'lng': round(lng, 6), 'status': 'pending',
                            'review_note': None, 'reviewed_by': None, 'reviewed_at': None,
                            'created_at': iso(at_offset(s['offset'])), 'offset_min': {'created_at': s['offset']}})
    key_map = {s['key']: did(s['key']) for s in SESSIONS}
    audit = []
    for i, (label, action, entity, eid, details, off) in enumerate(AUDIT):
        d = dict(details)
        d['seed'] = True
        audit.append({'id': i + 1, 'actor': None, 'actor_label': label, 'action': action, 'entity': entity,
                      'entity_id': key_map.get(eid, eid), 'details': d, 'created_at': iso(at_offset(off)),
                      'offset_min': {'created_at': off}})
    releases = []
    for c in CONTENT_RELEASES:
        releases.append({'id': c['id'], 'version': c['version'], 'kind': c['kind'], 'status': c['status'],
                         'notes': c['notes'], 'reviewer_round1': c['reviewer_round1'], 'approver': c['approver'],
                         'approved_at': c['approved_at'], 'created_at': iso(at_offset(c['offset']))})
    return devices, sessions, events, submissions, audit, releases


def build_all(offline=False, log=print):
    rng = random.Random(RNG_SEED)
    log('[1/4] route graphs (OSRM geometry, cached)')
    built = graph.build_routes(offline=offline, log=log)
    res = Resolver(built)
    log('[2/4] survey samples, IDW segments, held-out accuracy')
    samples, segments, accuracy, envs, next_id = build_signal(built, rng)
    samples.extend(build_community_samples(res, envs, rng, next_id))
    res.set_segments(segments)
    log('[3/4] facilities, services, admin demo data')
    facilities, services = build_pois(built, res, rng)
    devices, sessions, events, submissions, audit, releases = build_admin(res, facilities)
    routes, nodes, edges = [], [], []
    for r in built:
        rt = dict(r['route'])
        rt['geometry'] = [list(p) for p in rt['geometry']]
        routes.append({k: rt[k] for k in FIELDS['route']})
        nodes.extend({k: n[k] for k in FIELDS['node']} for n in r['nodes'])
        edges.extend({k: e[k] for k in FIELDS['edge']} for e in r['edges'])
    routes.sort(key=lambda x: x['sort'])
    packs = [{'route_id': r['id'], 'carrier': c['id'], 'version': 1, 'published_at': iso(PACK_PUBLISHED),
              'notes': 'Gói khởi tạo — dữ liệu minh hoạ'} for r in routes for c in CARRIERS]
    core = {
        'schema': 1,
        'notice': ('Dữ liệu minh hoạ (is_demo) cho cuộc thi AISC 2026 — không dùng cho cấp cứu thật. '
                   'Hình học đường © OpenStreetMap contributors (ODbL), định tuyến OSRM.'),
        'generated_at': iso(BUILT_AT), 'model_version': MODEL_VERSION, 'carriers': CARRIERS, 'routes': routes,
        'nodes': nodes, 'edges': edges,
        'segments': [{k: s[k] for k in FIELDS['segment']} for s in segments],
        'accuracy': [{k: a[k] for k in FIELDS['accuracy']} for a in accuracy],
        'facilities': facilities, 'services': services, 'submissions': submissions,
        'content_releases': releases, 'packs': packs,
    }
    admin = {
        'schema': 1, 'generated_at': iso(BUILT_AT), 'anchor_at': iso(ANCHOR),
        'samples': [{k: s[k] for k in FIELDS['sample']} for s in samples],
        'devices': devices, 'buddy_sessions': sessions, 'checkin_events': events, 'audit': audit,
    }
    return core, admin, samples


# ------------------------------------------------------------------------------------------ emit JS
def _js_block(obj):
    """JSON with one array element per line (readable diffs, compact size)."""
    parts = []
    for k, v in obj.items():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            body = ',\n'.join('    ' + json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in v)
            parts.append('  %s: [\n%s\n  ]' % (json.dumps(k), body))
        else:
            parts.append('  %s: %s' % (json.dumps(k), json.dumps(v, ensure_ascii=False, separators=(',', ':'))))
    return '{\n' + ',\n'.join(parts) + '\n}'


def write_js(path, var, obj, header):
    body = _js_block(obj).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    txt = ('/*\n * %s\n * GENERATED by tools/seed/build_seed.py — do not edit by hand (re-run the builder).\n'
           ' * Public API: window.%s (also module.exports under Node for tools/tests).\n'
           ' * ILLUSTRATIVE DATA ONLY (is_demo) — demo phone numbers use the invalid pattern +84 000 000 0NN.\n */\n'
           "(function (root) {\n  'use strict';\n  root.%s = %s;\n"
           "  if (typeof module !== 'undefined' && module.exports) { module.exports = root.%s; }\n"
           "})(typeof window !== 'undefined' ? window : globalThis);\n") % (header, var, var, body, var)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(txt)
    return len(txt.encode('utf-8'))


def read_js(path, var):
    with open(path, 'r', encoding='utf-8') as fh:
        txt = fh.read()
    start = txt.index('root.%s = ' % var) + len('root.%s = ' % var)
    end = txt.rindex(';\n  if (typeof module')
    return json.loads(txt[start:end]), len(txt.encode('utf-8'))


# ------------------------------------------------------------------------------------------ emit SQL
def sq(v):
    """SQL literal."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        return sq(json.dumps(v, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'
    return "'" + str(v).replace("'", "''") + "'"


def wkt_point(lat, lng):
    return "ST_GeogFromText('SRID=4326;POINT(%.6f %.6f)')" % (lng, lat)  # WKT = lng lat


def wkt_line(pts):
    return "ST_GeogFromText('SRID=4326;LINESTRING(%s)')" % ', '.join('%.5f %.5f' % (p[1], p[0]) for p in pts)


def rel(offset_min):
    return "(now() + interval '%d minutes')" % offset_min


def ts_rel(rec, field):
    off = (rec.get('offset_min') or {}).get(field)
    if rec.get(field) is None:
        return 'null'
    return rel(off) if off is not None else sq(rec[field])


def insert_rows(table, cols, rows, conflict=None, chunk=400):
    out = []
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        sql = 'insert into public.%s (%s) values\n  %s' % (table, ', '.join(cols), ',\n  '.join('(' + ', '.join(r) + ')' for r in part))
        if conflict:
            sql += '\n' + conflict
        out.append(sql + ';')
    return '\n'.join(out)


def upsert_clause(key, cols):
    sets = ', '.join('%s = excluded.%s' % (c, c) for c in cols if c not in key.split(', '))
    return 'on conflict (%s) do update set %s' % (key, sets)


def write_sql(core, admin, samples_full):
    """samples_full: internal sample dicts (they also carry device_model for the SQL column)."""
    route_ids = ', '.join(sq(r['id']) for r in core['routes'])
    L = []
    L.append('-- NomadCare v2 — supabase/seed.sql')
    L.append('-- GENERATED by tools/seed/build_seed.py (owner: P1 seed) — do not edit by hand.')
    L.append('-- ILLUSTRATIVE demo data (is_demo = true). Idempotent: safe to re-run; it upserts reference rows,')
    L.append('-- replaces team/demo signal data of the 3 pilot routes, and restores the demo buddy scenario')
    L.append('-- relative to now(). Real community rows and real devices/sessions are never touched.')
    L.append('-- Geometry WKT is "lng lat". Route geometry © OpenStreetMap contributors (ODbL).')
    L.append('set search_path = public, extensions;')
    L.append("set nc.actor = 'seed';          -- label for audit rows written by triggers (pack publishing below)")
    L.append('begin;')
    L.append("set local nc.audit = 'off';     -- bulk load: row-level audit triggers skip this transaction")
    L.append('')
    L.append('-- carriers ---------------------------------------------------------------')
    L.append(insert_rows('carriers', ['id', 'name', 'sort'], [[sq(c['id']), sq(c['name']), sq(c['sort'])] for c in core['carriers']],
                         upsert_clause('id', ['id', 'name', 'sort'])))
    L.append('')
    L.append('-- routes, nodes, edges ---------------------------------------------------')
    rcols = ['id', 'name', 'name_en', 'region', 'region_en', 'travel_mode', 'length_km', 'color', 'description_vi',
             'description_en', 'geom', 'bbox', 'sort', 'is_active']
    L.append(insert_rows('routes', rcols, [[sq(r['id']), sq(r['name']), sq(r['name_en']), sq(r['region']), sq(r['region_en']),
                                            sq(r['travel_mode']),
                                            sq(r['length_km']), sq(r['color']), sq(r['description_vi']), sq(r['description_en']),
                                            wkt_line(r['geometry']), sq(r['bbox']), sq(r['sort']), sq(r['is_active'])]
                                           for r in core['routes']], upsert_clause('id', rcols) + ', updated_at = now()', chunk=1))
    ncols = ['id', 'route_id', 'name', 'name_en', 'kind', 'geom']
    L.append(insert_rows('route_nodes', ncols, [[sq(n['id']), sq(n['route_id']), sq(n['name']), sq(n['name_en']), sq(n['kind']),
                                                  wkt_point(n['lat'], n['lng'])] for n in core['nodes']], upsert_clause('id', ncols)))
    ecols = ['id', 'route_id', 'from_node', 'to_node', 'length_km', 'is_connector', 'geom']
    L.append(insert_rows('route_edges', ecols, [[sq(e['id']), sq(e['route_id']), sq(e['from']), sq(e['to']), sq(e['length_km']),
                                                  sq(e['is_connector']), wkt_line(e['geometry'])] for e in core['edges']],
                         upsert_clause('id', ecols), chunk=5))
    L.append('')
    L.append('-- signal data of the pilot routes (team survey + seeded community reports) ---')
    L.append('delete from public.signal_segments where route_id in (%s);' % route_ids)
    L.append("delete from public.signal_samples where route_id in (%s) and (source = 'team' or device_model like '%%· demo');" % route_ids)
    edge_ids = ', '.join(sq(e['id']) for e in core['edges'])
    node_ids = ', '.join(sq(n['id']) for n in core['nodes'])
    L.append('delete from public.route_edges where route_id in (%s) and id not in (%s);' % (route_ids, edge_ids))
    L.append('delete from public.route_nodes where route_id in (%s) and id not in (%s);' % (route_ids, node_ids))
    scols = ['route_id', 'edge_id', 'carrier', 'tech', 'rsrp_dbm', 'level', 'geom', 'measured_at', 'source', 'status',
             'device_model', 'is_holdout']
    L.append(insert_rows('signal_samples', scols, [[sq(s['route_id']), sq(s['edge_id']), sq(s['carrier']), sq(s['tech']),
                                                    sq(s['rsrp_dbm']), sq(s['level']), wkt_point(s['lat'], s['lng']),
                                                    sq(s['measured_at']), sq(s['source']), sq(s['status']),
                                                    sq(s['device_model']), sq(s['is_holdout'])] for s in samples_full]))
    gcols = ['route_id', 'edge_id', 'carrier', 'seq', 'from_km', 'to_km', 'level', 'confidence', 'model_version']
    L.append(insert_rows('signal_segments', gcols, [[sq(g['route_id']), sq(g['edge_id']), sq(g['carrier']), sq(g['seq']),
                                                     sq(g['from_km']), sq(g['to_km']), sq(g['level']), sq(g['confidence']),
                                                     sq(core['model_version'])] for g in core['segments']]))
    acols = ['route_id', 'carrier', 'accuracy', 'holdout_n', 'model_version', 'computed_at']
    L.append(insert_rows('route_accuracy', acols, [[sq(a[c]) for c in acols] for a in core['accuracy']],
                         upsert_clause('route_id, carrier', acols)))
    L.append('')
    L.append('-- facilities & services (upsert by id) ----------------------------------')
    fcols = ['id', 'route_id', 'name', 'type', 'address', 'geom', 'phone', 'open_hours', 'night_shift', 'trauma_capable',
             'verified_by', 'verified_at', 'status', 'source', 'notes', 'is_demo', 'created_at', 'updated_at']
    L.append(insert_rows('facilities', fcols, [[sq(f['id']), sq(f['route_id']), sq(f['name']), sq(f['type']), sq(f['address']),
                                                 wkt_point(f['lat'], f['lng']), sq(f['phone']), sq(f['open_hours']),
                                                 sq(f['night_shift']), sq(f['trauma_capable']), sq(f['verified_by']),
                                                 sq(f['verified_at']), sq(f['status']), sq(f['source']), sq(f['notes']),
                                                 sq(f['is_demo']), sq(f['created_at']), sq(f['updated_at'])]
                                                for f in core['facilities']], upsert_clause('id', fcols)))
    vcols = ['id', 'route_id', 'name', 'type', 'geom', 'phone', 'open_hours', 'is_partner', 'commission_rate', 'status', 'notes',
             'is_demo', 'created_at', 'updated_at']
    L.append(insert_rows('services', vcols, [[sq(s['id']), sq(s['route_id']), sq(s['name']), sq(s['type']),
                                               wkt_point(s['lat'], s['lng']), sq(s['phone']), sq(s['open_hours']),
                                               sq(s['is_partner']), sq(s['commission_rate']), sq(s['status']), sq(s['notes']),
                                               sq(s['is_demo']), sq(s['created_at']), sq(s['updated_at'])]
                                              for s in core['services']], upsert_clause('id', vcols)))
    L.append('')
    L.append('-- content release under review -------------------------------------------')
    ccols = ['version', 'kind', 'status', 'notes', 'reviewer_round1', 'approver', 'approved_at', 'created_at']
    L.append(insert_rows('content_releases', ccols, [[sq(c[k]) for k in ccols] for c in core['content_releases']],
                         upsert_clause('version', ccols)))
    L.append('')
    L.append('-- demo devices, community submissions, buddy scenario (times relative to now()) ---')
    dcols = ['id', 'secret_hash', 'carrier', 'app_version', 'created_at', 'last_seen_at']
    L.append(insert_rows('devices', dcols, [[sq(d['id']), sq(d['secret_hash']), sq(d['carrier']), sq(d['app_version']),
                                              ts_rel(d, 'created_at'), ts_rel(d, 'last_seen_at')] for d in admin['devices']],
                         upsert_clause('id', dcols)))
    bcols = ['id', 'device_id', 'facility_id', 'kind', 'payload', 'lat', 'lng', 'status', 'review_note', 'reviewed_by',
             'reviewed_at', 'created_at']
    L.append(insert_rows('facility_submissions', bcols, [[sq(s['id']), sq(s['device_id']), sq(s['facility_id']), sq(s['kind']),
                                                          sq(s['payload']), sq(s['lat']), sq(s['lng']), sq(s['status']),
                                                          'null', 'null', 'null', ts_rel(s, 'created_at')]
                                                         for s in core['submissions']], upsert_clause('id', bcols)))
    sess_ids = ', '.join(sq(s['id']) for s in admin['buddy_sessions'])
    L.append('delete from public.checkin_events where session_id in (%s);' % sess_ids)
    tcols = ['id', 'device_id', 'traveler_name', 'recipient_name', 'recipient_email', 'recipient_phone', 'interval_min',
             'grace_min', 'route_id', 'travel_mode', 'share_public_medical', 'public_medical', 'status', 'started_at',
             'last_checkin_at', 'next_due_at', 'last_lat', 'last_lng', 'last_location_at', 'alerted_at', 'closed_at',
             'created_at', 'updated_at']
    tsf = {'started_at', 'last_checkin_at', 'next_due_at', 'last_location_at', 'alerted_at', 'closed_at', 'created_at', 'updated_at'}
    L.append(insert_rows('buddy_sessions', tcols, [[ts_rel(s, c) if c in tsf else sq(s[c]) for c in tcols]
                                                    for s in admin['buddy_sessions']], upsert_clause('id', tcols)))
    kcols = ['id', 'session_id', 'device_id', 'kind', 'lat', 'lng', 'accuracy_m', 'client_ts', 'received_at', 'queued', 'note', 'meta']
    L.append(insert_rows('checkin_events', kcols, [[ts_rel(e, c) if c in ('client_ts', 'received_at') else sq(e[c]) for c in kcols]
                                                    for e in admin['checkin_events']]))
    L.append('')
    L.append('-- audit trail of the seed (replaced on every run) ----------------------------')
    L.append("delete from public.audit_log where details ->> 'seed' = 'true';")
    ucols = ['actor', 'actor_label', 'action', 'entity', 'entity_id', 'details', 'created_at']
    L.append(insert_rows('audit_log', ucols, [['null', sq(a['actor_label']), sq(a['action']), sq(a['entity']), sq(a['entity_id']),
                                               sq(a['details']), ts_rel(a, 'created_at')] for a in admin['audit']]))
    L.append('')
    L.append('commit;')
    L.append('')
    L.append('-- initial data packs (version 1) — built server-side, no admin session needed ---------')
    L.append("""do $$
declare
  r record;
  p jsonb;
  has_publish boolean := exists (select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                                 where ns.nspname = 'app_private' and pr.proname = 'publish_pack');
  has_build boolean := exists (select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                               where ns.nspname = 'public' and pr.proname = 'build_data_pack');
begin
  if not has_publish and not has_build then
    raise notice 'build_data_pack() not found — skipping initial data packs (run the migrations first).';
    return;
  end if;
  for r in select ro.id as route_id, c.id as carrier from public.routes ro cross join public.carriers c
           where ro.id in (%s) order by ro.sort, c.sort loop
    if exists (select 1 from public.data_packs d where d.route_id = r.route_id and d.carrier = r.carrier) then
      continue;  -- never overwrite packs an admin already published
    end if;
    if has_publish then
      -- preferred: the publisher defined by the migrations (version = max + 1 = 1, sha256 checksum, is_current)
      perform app_private.publish_pack(r.route_id, r.carrier, 'Gói khởi tạo — dữ liệu minh hoạ (seed)', null);
    else
      p := public.build_data_pack(r.route_id, r.carrier) || jsonb_build_object('version', 1, 'published_at', now());
      p := p || jsonb_build_object('size_bytes', octet_length(p::text));
      insert into public.data_packs (route_id, carrier, version, published_at, notes, size_bytes, checksum, payload, is_current)
      values (r.route_id, r.carrier, 1, now(), 'Gói khởi tạo — dữ liệu minh hoạ (seed)',
              octet_length(p::text), md5(p::text), p, true);
    end if;
  end loop;
end $$;""" % route_ids)
    txt = '\n'.join(L) + '\n'
    os.makedirs(os.path.dirname(OUT_SQL), exist_ok=True)
    with open(OUT_SQL, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(txt)
    return len(txt.encode('utf-8'))


# ------------------------------------------------------------------------------------------ check
class Checker:
    def __init__(self):
        self.errors, self.warnings = [], []

    def ok(self, cond, msg):
        if not cond:
            self.errors.append(msg)
        return cond

    def warn(self, cond, msg):
        if not cond:
            self.warnings.append(msg)


def check(verbose=True):
    ck = Checker()
    core, core_size = read_js(OUT_CORE, 'NC_SEED')
    admin, admin_size = read_js(OUT_ADMIN, 'NC_SEED_ADMIN')
    # --- keys & record shapes
    ck.ok(list(core.keys()) == CORE_KEYS, 'NC_SEED keys %s' % list(core.keys()))
    ck.ok(list(admin.keys()) == ADMIN_KEYS, 'NC_SEED_ADMIN keys %s' % list(admin.keys()))
    shapes = [('route', core['routes']), ('node', core['nodes']), ('edge', core['edges']), ('segment', core['segments']),
              ('accuracy', core['accuracy']), ('facility', core['facilities']), ('service', core['services']),
              ('submission', core['submissions']), ('content_release', core['content_releases']), ('pack', core['packs']),
              ('sample', admin['samples']), ('device', admin['devices']), ('session', admin['buddy_sessions']),
              ('event', admin['checkin_events']), ('audit', admin['audit'])]
    for name, rows in shapes:
        bad = [r for r in rows if list(r.keys()) != FIELDS[name]]
        ck.ok(not bad, '%s: %d records with unexpected keys, e.g. %s' % (name, len(bad), bad[:1] and list(bad[0].keys())))
    # --- uniqueness
    for name, rows in shapes:
        if name in ('segment', 'accuracy', 'pack'):
            continue
        key = 'version' if name == 'content_release' else 'id'
        ids = [r[key] for r in rows]
        ck.ok(len(ids) == len(set(ids)), '%s ids not unique' % name)
    carriers = {c['id'] for c in core['carriers']}
    routes = {r['id']: r for r in core['routes']}
    nodes = {n['id']: n for n in core['nodes']}
    edges = {e['id']: e for e in core['edges']}
    facs = {f['id']: f for f in core['facilities']}
    devices = {d['id'] for d in admin['devices']}
    sessions = {s['id']: s for s in admin['buddy_sessions']}
    ck.ok(carriers == {'viettel', 'vinaphone', 'mobifone'}, 'carriers %s' % carriers)
    ck.ok(set(routes) == {'khanh-le', 'ta-nang-phan-dung', 'ha-giang-loop'}, 'routes %s' % set(routes))
    ck.ok(len({r['color'] for r in routes.values()}) == len(routes), 'route colors not distinct')
    ck.ok(all(r.get('region_en') for r in routes.values()), 'every route needs region_en (English UI label)')
    # --- graph integrity & geometry
    for rid, r in routes.items():
        rn = [n for n in nodes.values() if n['route_id'] == rid]
        ck.ok(len(rn) >= 10, '%s has only %d nodes' % (rid, len(rn)))
        pts = [tuple(p) for e in edges.values() if e['route_id'] == rid for p in e['geometry']]
        s, w, n, e_ = r['bbox']
        ck.ok(all(s <= p[0] <= n and w <= p[1] <= e_ for p in pts), '%s bbox does not contain its edges' % rid)
        ck.ok(abs(geo.line_length_km([tuple(p) for p in r['geometry']]) - r['length_km']) < 0.6,
              '%s length_km differs from its main geometry' % rid)
    for e in edges.values():
        ck.ok(e['route_id'] in routes, 'edge %s bad route' % e['id'])
        for end, idx in (('from', 0), ('to', -1)):
            n = nodes.get(e[end])
            if ck.ok(n is not None and n['route_id'] == e['route_id'], 'edge %s %s node invalid' % (e['id'], end)):
                ck.ok(geo.haversine_km((n['lat'], n['lng']), tuple(e['geometry'][idx])) < 0.005,
                      'edge %s geometry does not start/end at its %s node' % (e['id'], end))
        L = geo.line_length_km([tuple(p) for p in e['geometry']])
        ck.ok(abs(L - e['length_km']) <= max(0.002, 0.001 * L), 'edge %s length_km %.3f vs geometry %.3f' % (e['id'], e['length_km'], L))
    # connectivity of each route graph
    for rid in routes:
        adj = {}
        for e in edges.values():
            if e['route_id'] == rid:
                adj.setdefault(e['from'], set()).add(e['to'])
                adj.setdefault(e['to'], set()).add(e['from'])
        start = next(iter(adj))
        seen, stack = {start}, [start]
        while stack:
            for m in adj[stack.pop()]:
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        rn = {n['id'] for n in nodes.values() if n['route_id'] == rid}
        ck.ok(seen == rn, '%s graph not connected: %s' % (rid, rn - seen))
    # sanity legs (task spec): Hà Giang -> Đồng Văn, Đà Lạt -> Nha Trang, trek
    def chain_km(ids):
        tot = 0.0
        for a, b in zip(ids, ids[1:]):
            m = [e for e in edges.values() if (e['from'], e['to']) in ((a, b), (b, a))]
            if not ck.ok(len(m) == 1, 'no edge %s-%s' % (a, b)):
                return 0.0
            tot += m[0]['length_km']
        return tot
    hg_dv = chain_km(['hg-ha-giang', 'hg-bac-sum', 'hg-quan-ba-gate', 'hg-quan-ba', 'hg-yen-minh', 'hg-yen-minh-jct',
                      'hg-tham-ma', 'hg-sung-la', 'hg-sa-phin', 'hg-lung-cu-jct', 'hg-dong-van'])
    ck.ok(132 <= hg_dv <= 152, 'Hà Giang → Đồng Văn = %.1f km (expected ~140)' % hg_dv)
    ck.ok(125 <= routes['khanh-le']['length_km'] <= 150, 'Đà Lạt → Nha Trang = %.1f km' % routes['khanh-le']['length_km'])
    ck.ok(30 <= routes['ta-nang-phan-dung']['length_km'] <= 80, 'trek length %.1f km' % routes['ta-nang-phan-dung']['length_km'])
    # --- segments: full contiguous coverage per edge x carrier
    by = {}
    for g in core['segments']:
        ck.ok(g['edge_id'] in edges and g['carrier'] in carriers and edges[g['edge_id']]['route_id'] == g['route_id'],
              'segment FK %s' % g)
        ck.ok(g['level'] in ('likely', 'uncertain', 'lost'), 'segment level %s' % g['level'])
        ck.ok(0 <= g['confidence'] <= 1, 'segment confidence %s' % g['confidence'])
        by.setdefault((g['edge_id'], g['carrier']), []).append(g)
    for e in edges.values():
        for c in carriers:
            segs = sorted(by.get((e['id'], c), []), key=lambda x: x['seq'])
            if not ck.ok(segs, 'edge %s carrier %s has no segments' % (e['id'], c)):
                continue
            ck.ok([s['seq'] for s in segs] == list(range(len(segs))), 'edge %s/%s seq not 0..n' % (e['id'], c))
            ck.ok(segs[0]['from_km'] == 0, 'edge %s/%s does not start at 0' % (e['id'], c))
            ck.ok(segs[-1]['to_km'] == e['length_km'], 'edge %s/%s ends at %s != %s' % (e['id'], c, segs[-1]['to_km'], e['length_km']))
            for a, b in zip(segs, segs[1:]):
                ck.ok(a['to_km'] == b['from_km'], 'edge %s/%s gap at %s' % (e['id'], c, a['to_km']))
                ck.ok(a['level'] != b['level'], 'edge %s/%s adjacent runs share a level' % (e['id'], c))
            for s in segs:
                ck.ok(s['to_km'] > s['from_km'], 'edge %s/%s empty run' % (e['id'], c))
    # accuracy & packs complete
    acc = {(a['route_id'], a['carrier']): a for a in core['accuracy']}
    pk = {(p['route_id'], p['carrier']) for p in core['packs']}
    for rid in routes:
        for c in carriers:
            a = acc.get((rid, c))
            ck.ok(a is not None and a['accuracy'] is not None and 0 <= a['accuracy'] <= 1 and a['holdout_n'] > 0,
                  'accuracy missing for %s/%s' % (rid, c))
            ck.ok((rid, c) in pk, 'pack missing for %s/%s' % (rid, c))
    # --- facilities / services
    for f in core['facilities']:
        ck.ok(f['route_id'] in routes and f['is_demo'] is True, 'facility %s route/demo' % f['id'])
        ck.ok(f['type'] in ('tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc'), 'facility %s type' % f['id'])
        ck.ok(f['status'] in ('verified', 'pending', 'rejected') and f['source'] in ('team', 'community'), 'facility %s status' % f['id'])
        ck.ok(f['phone'] is None or PHONE_RE.match(f['phone']), 'facility %s phone %s' % (f['id'], f['phone']))
        if f['status'] == 'verified':
            miss = [k for k in REQUIRED_VERIFIED if f.get(k) is None or f.get(k) == '']
            ck.ok(not miss, 'verified facility %s incomplete: %s' % (f['id'], miss))
        if f['status'] == 'pending':
            ck.warn(any(f.get(k) is None for k in REQUIRED_VERIFIED), 'pending facility %s has no missing field' % f['id'])
        ck.ok(geo.haversine_km(tuple(routes[f['route_id']]['geometry'][0]), (f['lat'], f['lng'])) < 400, 'facility %s far away' % f['id'])
    for s in core['services']:
        ck.ok(s['route_id'] in routes and s['is_demo'] is True and PHONE_RE.match(s['phone']), 'service %s' % s['id'])
        ck.ok(s['type'] in ('lodging', 'repair', 'fuel', 'rental') and s['status'] in ('active', 'inactive'), 'service %s type' % s['id'])
        ck.ok((not s['is_partner']) or s['commission_rate'] in (0.08, 0.0), 'service %s commission' % s['id'])
        ck.ok(s['commission_rate'] == 0 or s['type'] != 'lodging', 'lodging %s must not carry a commission' % s['id'])
    for rid in routes:
        fr = [f for f in core['facilities'] if f['route_id'] == rid]
        sv = [s for s in core['services'] if s['route_id'] == rid]
        ck.ok(18 <= len(fr) <= 24, '%s has %d facilities' % (rid, len(fr)))
        ck.ok(10 <= len(sv) <= 15, '%s has %d services' % (rid, len(sv)))
        ck.ok(1 <= sum(1 for f in fr if f['status'] == 'rejected') <= 2, '%s rejected count' % rid)
        ck.ok(sum(1 for f in fr if f['status'] == 'pending') >= 1, '%s has no pending facility' % rid)
    ver = [f for f in core['facilities'] if f['status'] == 'verified']
    stale = [f for f in ver if dt.date.fromisoformat(f['verified_at']) < STALE_BEFORE]
    share = len(stale) / len(core['facilities'])
    ck.ok(0.10 <= share <= 0.22, 'stale share %.2f (target ~15%%)' % share)
    ck.ok(all(f['verified_at'].startswith('2026') for f in ver), 'verified_at must be in 2026')
    # --- submissions / content / admin FKs
    ck.ok(4 <= len(core['submissions']) <= 8 and all(s['status'] == 'pending' for s in core['submissions']), 'submissions')
    for s in core['submissions']:
        ck.ok(s['facility_id'] is None or s['facility_id'] in facs, 'submission %s facility FK' % s['id'])
        ck.ok(s['device_id'] in devices, 'submission %s device FK' % s['id'])
        ck.ok(s['kind'] in ('new', 'correction', 'closed', 'signal_report'), 'submission kind')
    cr = core['content_releases']
    live = [c for c in cr if c['status'] in ('in_review', 'approved')]
    ck.ok(len(live) == 1 and live[0]['version'] == '1.1.0-demo' and live[0]['status'] == 'in_review' and live[0]['approver'] is None,
          'content release (one current release, 1.1.0-demo in review)')
    ck.ok(all(c['approver'] is None and c['status'] in ('in_review', 'retracted') for c in cr), 'content releases unsigned')
    # --- samples
    for s in admin['samples']:
        ck.ok(s['edge_id'] in edges and edges[s['edge_id']]['route_id'] == s['route_id'] and s['carrier'] in carriers,
              'sample %s FK' % s['id'])
        ck.ok((s['tech'] == 'none') == (s['rsrp_dbm'] is None), 'sample %s tech/rsrp' % s['id'])
        ck.ok(s['level'] == sm.level_of(s['rsrp_dbm']), 'sample %s level inconsistent' % s['id'])
        ck.ok(s['tech'] in ('5G', '4G', '3G', '2G', 'none'), 'sample tech')
    for rid in routes:
        for c in carriers:
            team = [s for s in admin['samples'] if s['route_id'] == rid and s['carrier'] == c and s['source'] == 'team']
            h = sum(1 for s in team if s['is_holdout'])
            ck.ok(abs(h / len(team) - 0.2) < 0.01, '%s/%s holdout share %.3f' % (rid, c, h / len(team)))
    comm = [s for s in admin['samples'] if s['source'] == 'community']
    ck.ok(comm and all(s['status'] == 'pending' and not s['is_holdout'] for s in comm), 'community samples must be pending')
    # sample spacing ~400 m: per edge x carrier, count ~= length/0.4
    for e in edges.values():
        n = sum(1 for s in admin['samples'] if s['edge_id'] == e['id'] and s['carrier'] == 'viettel' and s['source'] == 'team')
        ck.ok(n == max(1, int(round(e['length_km'] / 0.4))), 'edge %s sample count %d' % (e['id'], n))
    # --- buddy scenario
    statuses = sorted(s['status'] for s in sessions.values())
    ck.ok(statuses == ['active', 'active', 'alerted', 'closed', 'overdue'], 'session statuses %s' % statuses)
    anchor = dt.datetime.fromisoformat(admin['anchor_at'])
    for s in sessions.values():
        ck.ok(s['device_id'] in devices and s['route_id'] in routes, 'session %s FK' % s['id'])
        ck.ok(s['recipient_email'].endswith('@example.com'), 'session %s must use example.com' % s['id'])
        due = dt.datetime.fromisoformat(s['next_due_at'])
        last = dt.datetime.fromisoformat(s['last_checkin_at'])
        ck.ok(due - last == dt.timedelta(minutes=s['interval_min']), 'session %s next_due != last + interval' % s['id'])
        late = anchor > due + dt.timedelta(minutes=s['grace_min'])
        if s['status'] == 'active':
            ck.ok(not late, 'active session %s is already overdue at anchor' % s['id'])
        if s['status'] in ('overdue', 'alerted'):
            ck.ok(late, '%s session %s is not late at anchor' % (s['status'], s['id']))
        ck.ok((s['status'] == 'alerted') == (s['alerted_at'] is not None), 'session %s alerted_at' % s['id'])
        ck.ok((s['status'] == 'closed') == (s['closed_at'] is not None), 'session %s closed_at' % s['id'])
        for k, off in s['offset_min'].items():
            ck.ok(dt.datetime.fromisoformat(s[k]) == anchor + dt.timedelta(minutes=off), 'session %s offset %s' % (s['id'], k))
    for ev in admin['checkin_events']:
        ck.ok(ev['session_id'] in sessions and ev['device_id'] in devices, 'event %s FK' % ev['id'])
        ck.ok(ev['kind'] in ('start', 'checkin', 'location', 'pre_deadzone', 'sos', 'overdue', 'alert_sent',
                             'alert_failed', 'stop', 'resolved'), 'event kind %s' % ev['kind'])
    # physical consistency: a device can only deliver a live (non-queued) event where its carrier has signal
    dev_carrier = {d['id']: d['carrier'] for d in admin['devices']}
    seg_by = {}
    for g in core['segments']:
        seg_by.setdefault((g['edge_id'], g['carrier']), []).append(g)
    for ev in admin['checkin_events']:
        if ev['accuracy_m'] is None or ev['queued'] or ev['session_id'] not in sessions:
            continue  # server-generated or delivered later from the outbox
        rid = sessions[ev['session_id']]['route_id']
        best = None
        for e in edges.values():
            if e['route_id'] != rid:
                continue
            km, d, _ = geo.nearest_on_line([tuple(p) for p in e['geometry']], (ev['lat'], ev['lng']))
            if best is None or d < best[0]:
                best = (d, e, km)
        lvl = sm.level_at(sorted(seg_by[(best[1]['id'], dev_carrier[ev['device_id']])], key=lambda g: g['seq']), best[2])
        ck.ok(best[0] < 0.05 and lvl != 'lost', 'event %s (%s) sent live from a %s zone / %.0f m off route'
              % (ev['id'], ev['kind'], lvl, best[0] * 1000))
    due_soon = [s for s in sessions.values() if s['status'] == 'active'
                and dt.datetime.fromisoformat(s['next_due_at']) - anchor <= dt.timedelta(minutes=15)]
    ck.ok(len(due_soon) == 1, 'expected exactly one active session due within 15 min of the anchor')
    # --- sizes & JS validity
    ck.ok(core_size <= 700 * 1024, 'seed-core.js is %.0f KB (> 700 KB)' % (core_size / 1024))
    ck.ok(admin_size <= 1.5 * 1024 * 1024, 'seed-admin.js is %.0f KB (> 1.5 MB)' % (admin_size / 1024))
    node_bin = shutil.which('node')
    if node_bin:
        for path, var in ((OUT_CORE, 'NC_SEED'), (OUT_ADMIN, 'NC_SEED_ADMIN')):
            r = subprocess.run([node_bin, '-e', "const s=require(process.argv[1]);if(!s||!s.schema)process.exit(2);"
                                "if(!globalThis.%s)process.exit(3);" % var, path], capture_output=True, text=True)
            ck.ok(r.returncode == 0, 'node cannot load %s: %s' % (os.path.basename(path), r.stderr.strip()[:200]))
    else:
        ck.warn(False, 'node not found — skipped JS load test')
    # --- SQL sanity
    if ck.ok(os.path.exists(OUT_SQL), 'supabase/seed.sql missing'):
        with open(OUT_SQL, encoding='utf-8') as fh:
            sql = fh.read()
        coords = re.findall(r'POINT\(([-\d.]+) ([-\d.]+)\)', sql)
        ck.ok(coords and all(100 < float(x) < 112 and 8 < float(y) < 24 for x, y in coords), 'SQL POINT is not "lng lat"')
        ck.ok(sql.count('insert into public.signal_samples') >= 1 and 'build_data_pack' in sql, 'SQL content')
        ck.ok(sql.count("'") % 2 == 0, 'SQL has unbalanced quotes')
    # --- summary
    if verbose:
        print_summary(core, admin, core_size, admin_size)
    for w in ck.warnings:
        print('WARN  ' + w)
    for e in ck.errors:
        print('FAIL  ' + e)
    print('check: %s (%d errors, %d warnings)' % ('OK' if not ck.errors else 'FAILED', len(ck.errors), len(ck.warnings)))
    return not ck.errors


def print_summary(core, admin, core_size, admin_size):
    routes = core['routes']
    print('\n%-18s %8s %8s %5s %5s | %-15s | %4s | %-22s | %-21s | %s' % (
        'route', 'main km', 'net km', 'nodes', 'edges', 'fac v/stale/p/r', 'svc', 'samples team/hold/comm',
        'accuracy vt/vn/mb', 'lost km% vt/vn/mb'))
    print('-' * 150)
    stale_before = STALE_BEFORE
    for r in routes:
        rid = r['id']
        es = [e for e in core['edges'] if e['route_id'] == rid]
        fr = [f for f in core['facilities'] if f['route_id'] == rid]
        v = [f for f in fr if f['status'] == 'verified']
        st = sum(1 for f in v if dt.date.fromisoformat(f['verified_at']) < stale_before)
        sa = [s for s in admin['samples'] if s['route_id'] == rid]
        acc = {a['carrier']: a['accuracy'] for a in core['accuracy'] if a['route_id'] == rid}
        lost = {}
        for c in ('viettel', 'vinaphone', 'mobifone'):
            segs = [g for g in core['segments'] if g['route_id'] == rid and g['carrier'] == c]
            tot = sum(g['to_km'] - g['from_km'] for g in segs)
            lost[c] = 100 * sum(g['to_km'] - g['from_km'] for g in segs if g['level'] == 'lost') / tot
        print('%-18s %8.1f %8.1f %5d %5d | %2d/%d/%d/%d %8s | %4d | %5d/%4d/%3d %9s | %.3f/%.3f/%.3f %3s | %3.0f/%3.0f/%3.0f' % (
            rid, r['length_km'], sum(e['length_km'] for e in es),
            sum(1 for n in core['nodes'] if n['route_id'] == rid), len(es),
            len(v), st, sum(1 for f in fr if f['status'] == 'pending'), sum(1 for f in fr if f['status'] == 'rejected'), '',
            sum(1 for s in core['services'] if s['route_id'] == rid),
            sum(1 for s in sa if s['source'] == 'team'), sum(1 for s in sa if s['is_holdout']),
            sum(1 for s in sa if s['source'] == 'community'), '',
            acc['viettel'], acc['vinaphone'], acc['mobifone'], '', lost['viettel'], lost['vinaphone'], lost['mobifone']))
    print('-' * 150)
    print('segments %d | facilities %d | services %d | submissions %d | samples %d | sessions %d | events %d | audit %d' % (
        len(core['segments']), len(core['facilities']), len(core['services']), len(core['submissions']),
        len(admin['samples']), len(admin['buddy_sessions']), len(admin['checkin_events']), len(admin['audit'])))
    print('sizes: seed-core.js %.0f KB (≤ 700) | seed-admin.js %.0f KB (≤ 1536) | seed.sql %.0f KB\n' % (
        core_size / 1024, admin_size / 1024, os.path.getsize(OUT_SQL) / 1024 if os.path.exists(OUT_SQL) else 0))


# ------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true', help='never touch the network (cache only)')
    ap.add_argument('--check', action='store_true', help='validate generated files and print a summary')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()
    if args.check:
        sys.exit(0 if check() else 1)
    log = (lambda *a: None) if args.quiet else print
    core, admin, samples_full = build_all(offline=args.offline, log=log)
    log('[4/4] writing outputs')
    n1 = write_js(OUT_CORE, 'NC_SEED', core, 'NomadCare — seed-core.js: routes, graph, signal segments, accuracy, '
                  'facilities, services, submissions (owner: P1 seed).')
    n2 = write_js(OUT_ADMIN, 'NC_SEED_ADMIN', admin, 'NomadCare — seed-admin.js: raw signal samples, demo devices, '
                  'buddy sessions, check-in events, audit (owner: P1 seed; loaded by admin.html only).')
    n3 = write_sql(core, admin, samples_full)
    log('  %s  %.0f KB\n  %s  %.0f KB\n  %s  %.0f KB' % (os.path.relpath(OUT_CORE, ROOT), n1 / 1024,
                                                     os.path.relpath(OUT_ADMIN, ROOT), n2 / 1024,
                                                     os.path.relpath(OUT_SQL, ROOT), n3 / 1024))
    log('run with --check to validate.')


if __name__ == '__main__':
    main()
