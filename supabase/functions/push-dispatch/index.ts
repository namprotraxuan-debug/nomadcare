// =============================================================================
// NomadCare v2 — Edge Function "push-dispatch" (Deno, Supabase Edge Runtime)
// Owner: W6 (round 2 R6). Sends the pre-dead-zone reminders as Web Push, so they
// arrive while the app is closed (Supabase mode; the local build keeps in-app timers).
//
// Called by: pg_cron → public.nc_push_tick() (every minute, only when a reminder
// is due) → pg_net POST {functions_url}/push-dispatch, header x-nc-cron-secret.
// Flow: public.nc_push_claim(limit) → for each reminder and each subscription of
// its device: web-push (VAPID) → public.nc_push_result(id, ok, error, gone[]).
// Subscriptions answered 404 / 410 are deleted (the browser dropped them).
// Payload (JSON, generic — NO coordinates, NO names): {title, body, tag, url,
// kind:'deadzone_ahead', minutes_before} in the subscription's language (vi | en);
// TTL = minutes_before (a reminder that arrives after the dead zone is useless).
// Response: { ok, processed, sent, failed, gone, dry_run, results[] }.
//
// Secrets (Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   VAPID_PUBLIC_KEY   base64url P-256 public key (also in assets/js/config.js vapidPublicKey)
//   VAPID_PRIVATE_KEY  base64url private key (never in the app)
//   VAPID_SUBJECT      contact of the sender: "mailto:team@example.org" or an https:// URL
//   CRON_SECRET        same value as app_private.settings.cron_secret (shared with deadman-alert)
//   PUSH_DRY_RUN       "1" = do not call the push services, record the reminders as sent (demo)
// Generate a key pair once: `npx web-push generate-vapid-keys`.
// Endpoints are re-checked against the browser push services (FCM, Mozilla, Apple,
// WNS), like app_private.valid_push_endpoint: the function never POSTs elsewhere.
// Deploy with JWT verification OFF (auth is the cron secret), as deadman-alert.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

// ------------------------------------------------------------------ types ----
interface Subscription { endpoint: string; p256dh: string; auth: string; lang: "vi" | "en" | string }
/** Row returned by public.nc_push_claim() (20260930000200). */
interface Reminder {
  id: number;
  kind: "deadzone_ahead" | string;
  minutes_before: number;
  zone_km: number | null;
  fire_at: string;
  subscriptions: Subscription[];
}
interface RpcError { message: string; code?: string }
type Db = ReturnType<typeof createClient>;

// ----------------------------------------------------------------- config ----
const env = (key: string, fallback = ""): string => (Deno.env.get(key) ?? fallback).trim();
const CONFIG = {
  supabaseUrl: env("SUPABASE_URL"),
  serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY"),
  cronSecret: env("CRON_SECRET"),
  vapidPublic: env("VAPID_PUBLIC_KEY"),
  vapidPrivate: env("VAPID_PRIVATE_KEY"),
  vapidSubject: env("VAPID_SUBJECT", "mailto:nomadcare@example.org"),
  dryRun: ["1", "true", "yes"].includes(env("PUSH_DRY_RUN").toLowerCase()),
  batchLimit: 100,
};
// = app_private.valid_push_endpoint / validPushEndpoint in backend-local.js
const PUSH_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(\/|$)/i;

export function validEndpoint(u: unknown): u is string {
  return typeof u === "string" && u.length <= 1024 && PUSH_HOST_RE.test(u);
}

/** Generic, coordinate-free notification text (the app shows the details). */
export function payloadFor(r: Reminder, lang: string): { title: string; body: string; tag: string; url: string; kind: string; minutes_before: number } {
  const min = Math.max(1, Math.round(Number(r.minutes_before) || 0));
  const en = lang === "en";
  const km = Number(r.zone_km);
  return {
    title: en ? "NomadCare: no-signal area ahead" : "NomadCare: sắp vào vùng mất sóng",
    body: en
      ? `In about ${min} min. Open NomadCare to send your coordinates to your contact.`
      : `Khoảng ${min} phút nữa. Mở NomadCare để gửi toạ độ cho người thân.`,
    tag: `nc-dz-${Number.isFinite(km) ? km.toFixed(3) : "0.000"}`,
    url: `./index.html?nc_alert=push#/map`,
    kind: "deadzone_ahead",
    minutes_before: min,
  };
}

// ------------------------------------------------------------ HTTP helpers ----
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
/** Constant-time string comparison (avoids leaking the secret through timing). */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

interface SendOutcome { ok: boolean; gone: boolean; status?: number; error?: string }

async function sendOne(sub: Subscription, payload: string, ttl: number): Promise<SendOutcome> {
  if (!validEndpoint(sub.endpoint)) return { ok: false, gone: true, error: "endpoint_not_allowed" };
  if (CONFIG.dryRun) return { ok: true, gone: false, status: 201 };
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: ttl, urgency: "high", timeout: 10_000 },
    );
    return { ok: true, gone: false, status: res.statusCode };
  } catch (err) {
    const status = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
    const gone = status === 404 || status === 410;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, gone, status, error: `push ${status ?? "network"}: ${msg}`.slice(0, 300) };
  }
}

// -------------------------------------------------------------- handler ----
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!CONFIG.supabaseUrl || !CONFIG.serviceKey) return json({ ok: false, error: "server_misconfigured" }, 500);
  const given = req.headers.get("x-nc-cron-secret");
  if (!CONFIG.cronSecret || !given || !safeEqual(given, CONFIG.cronSecret)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!CONFIG.dryRun && (!CONFIG.vapidPublic || !CONFIG.vapidPrivate)) {
    return json({ ok: false, error: "vapid_not_configured" }, 500);
  }
  if (!CONFIG.dryRun) webpush.setVapidDetails(CONFIG.vapidSubject, CONFIG.vapidPublic, CONFIG.vapidPrivate);

  const db: Db = createClient(CONFIG.supabaseUrl, CONFIG.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("nc_push_claim", { p_limit: CONFIG.batchLimit });
  if (error) {
    console.error("nc_push_claim failed", (error as RpcError).message);
    return json({ ok: false, error: "claim_failed", detail: (error as RpcError).message }, 500);
  }
  const reminders = (Array.isArray(data) ? data : []) as Reminder[];

  const results: Array<{ id: number; ok: boolean; sent: number; failed: number; gone: number; error?: string }> = [];
  let goneTotal = 0;
  for (const r of reminders) {
    const subs = Array.isArray(r.subscriptions) ? r.subscriptions : [];
    const ttl = Math.max(60, Math.round((Number(r.minutes_before) || 5) * 60));
    let sent = 0;
    let failed = 0;
    let firstError: string | undefined;
    const gone: string[] = [];
    for (const sub of subs) {
      const out = await sendOne(sub, JSON.stringify(payloadFor(r, sub.lang)), ttl);
      if (out.ok) sent++;
      else {
        failed++;
        firstError = firstError ?? out.error;
        if (out.gone && typeof sub.endpoint === "string") gone.push(sub.endpoint);
      }
    }
    // sent to at least one browser = done; none reached (all gone / no subscription) = done too, nothing to retry
    const ok = sent > 0 || (failed === gone.length);
    const { error: recErr } = await db.rpc("nc_push_result", {
      p_id: r.id, p_ok: ok, p_error: ok ? null : (firstError ?? "send_failed"), p_gone: gone.length ? gone : null,
    });
    if (recErr) console.error("nc_push_result failed", r.id, (recErr as RpcError).message);
    goneTotal += gone.length;
    results.push({ id: r.id, ok, sent, failed, gone: gone.length, ...(ok ? {} : { error: firstError ?? "send_failed" }) });
  }
  const summary = {
    ok: results.every((x) => x.ok),
    processed: results.length,
    sent: results.reduce((a, x) => a + x.sent, 0),
    failed: results.reduce((a, x) => a + x.failed, 0),
    gone: goneTotal,
    dry_run: CONFIG.dryRun,
    results,
  };
  // no personal data in logs: counts only
  console.log("push-dispatch", JSON.stringify({ processed: summary.processed, sent: summary.sent, failed: summary.failed, gone: goneTotal }));
  return json(summary, 200);
});
