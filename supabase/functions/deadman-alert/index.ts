// =============================================================================
// NomadCare v2 — Edge Function "deadman-alert" (Deno, Supabase Edge Runtime)
// Owner: P1 database. Sends the Buddy Check-in dead-man alert e-mails via Resend.
//
// Called by:
//   * pg_cron → nc_dispatch_alerts() → pg_net POST, header x-nc-cron-secret
//   * the admin dashboard, header Authorization: Bearer <admin user JWT>
// Body (JSON, optional):  { session_id?: uuid, type?: 'overdue' | 'resolved', inline?: payload }
//   - no session_id   → every overdue session that is due (cron path; the SQL
//                       side applies the abuse quota: 3 e-mails / recipient / 24 h)
//   - session_id      → that session (admin: sent even if not overdue yet, never
//                       rate-limited, attributed to the admin in the audit log)
//   - type 'resolved' → the "all clear" e-mail for session_id
//   - inline (cron secret only, type 'resolved') → all-clear built by SQL for a
//                       session that is being erased (device.erase): no DB read
// Response: { ok, mode, type, processed, sent, failed, dry_run, error?, results[] }
//   ok = false when at least one e-mail failed; error = the first failure;
//   results[] = { session_id, status: 'sent' | 'failed', provider, reason, id?, error? }
//
// Secrets (Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   RESEND_API_KEY   Resend API key (required unless ALERT_DRY_RUN=1)
//   CRON_SECRET      shared secret, same value as app_private.settings.cron_secret
//   ALERT_FROM       sender, default "NomadCare <onboarding@resend.dev>"
//   ALERT_REPLY_TO   optional reply-to address
//   ALLOWED_ORIGINS  optional, comma separated dashboard origins (default "*")
//   ALERT_DRY_RUN    "1" = do not call Resend, record a fake provider id (demo)
// Reasons: overdue | sos | manual | resolved (all clear) | contact_lost (round 2 R6,
// migration 20260930000200: the live app stopped sending its heartbeat outside a
// predicted dead zone — the e-mail says so, with the last signal and location).
// Recipients on reserved domains (example.com, *.test, …: the demo seed) are
// never e-mailed; the send is simulated and recorded with provider "demo".
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// All database logic (eligibility, claims, backoff, status changes) lives in
// SQL: public.nc_alert_claim() / public.nc_alert_result() (service_role only).
// Deploy with JWT verification OFF (auth is checked here): see supabase/README.md.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------ types ----
type AlertType = "overdue" | "resolved";
type Reason = "overdue" | "sos" | "manual" | "resolved" | "contact_lost";

interface PublicMedical {
  blood_type?: string;
  allergies?: string;
  conditions?: string;
  medications?: string;
  notes?: string;
}

/** Row returned by public.nc_alert_claim() (see 0800_cron.sql, alert_payload). */
interface AlertPayload {
  id: string;
  type: AlertType;
  reason: Reason;
  alert_reason?: "overdue" | "sos" | "contact_lost" | null;
  sos_at?: string | null;
  traveler_name: string | null;
  recipient_name: string | null;
  recipient_email: string;
  recipient_phone: string | null;
  route_id: string | null;
  route_name: string | null;
  route_name_en: string | null;
  travel_mode: string | null;
  interval_min: number;
  grace_min: number;
  status: string;
  started_at: string | null;
  last_checkin_at: string | null;
  next_due_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: string | null;
  /** round 2 R6 (20260930000200): last heartbeat of the app (reason contact_lost) */
  last_heartbeat_at?: string | null;
  heartbeat_state?: "live" | "paused" | null;
  silence_until?: string | null;
  overdue_by_min: number;
  share_public_medical: boolean;
  public_medical: PublicMedical | null;
  resolved_note: string | null;
  claim_at: string;
  server_time: string;
}

type Caller = { mode: "cron" } | { mode: "admin"; userId: string };

interface RpcError { message: string; code?: string }
type Db = ReturnType<typeof createClient>;

interface SendResult {
  ok: boolean;
  provider: "resend" | "dry-run" | "demo";
  id?: string;
  error?: string;
}

// ----------------------------------------------------------------- config ----
const env = (key: string, fallback = ""): string => (Deno.env.get(key) ?? fallback).trim();

const CONFIG = {
  supabaseUrl: env("SUPABASE_URL"),
  serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY"),
  resendKey: env("RESEND_API_KEY"),
  cronSecret: env("CRON_SECRET"),
  from: env("ALERT_FROM", "NomadCare <onboarding@resend.dev>"),
  replyTo: env("ALERT_REPLY_TO"),
  allowedOrigins: env("ALLOWED_ORIGINS", "*").split(",").map((s) => s.trim()).filter(Boolean),
  dryRun: ["1", "true", "yes"].includes(env("ALERT_DRY_RUN").toLowerCase()),
  batchLimit: 25,
  resendGapMs: 600, // Resend default rate limit is 2 requests / second
  timeZone: "Asia/Ho_Chi_Minh",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RFC 2606 / 6761 reserved domains (used by the demo seed): never e-mailed for
// real; the send is simulated (provider "demo"), like the local mock backend.
const RESERVED_DOMAIN_RE = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

function isReservedRecipient(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at < 0 || RESERVED_DOMAIN_RE.test(email.slice(at + 1).trim());
}

/** All-clear payload built by SQL (op_device_erase) and sent inline by pg_net. */
function inlinePayload(value: unknown): AlertPayload | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<AlertPayload>;
  if (typeof p.id !== "string" || !UUID_RE.test(p.id)) return null;
  if (typeof p.recipient_email !== "string" || !p.recipient_email.includes("@")) return null;
  return { ...(p as AlertPayload), type: "resolved", reason: "resolved" };
}

/**
 * RPC with the wave-3 arguments (p_actor, p_reason); when the database still has
 * the older signature (migration 20260928000100 not applied) retry without them.
 */
// deno-lint-ignore no-explicit-any
async function rpcCompat(db: Db, fn: string, args: Record<string, unknown>, extra: Record<string, unknown>): Promise<{ data: any; error: RpcError | null }> {
  const first = await db.rpc(fn, { ...args, ...extra });
  const err = first.error as RpcError | null;
  if (!err || Object.keys(extra).length === 0) return first;
  if (err.code === "PGRST202" || /could not find the function|does not exist/i.test(err.message)) {
    return await db.rpc(fn, args);
  }
  return first;
}

// ------------------------------------------------------------ HTTP helpers ----
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const list = CONFIG.allowedOrigins;
  const allow = list.length === 0 || list.includes("*") ? "*" : list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ auth ----
async function authenticate(req: Request, db: Db): Promise<Caller | null> {
  const given = req.headers.get("x-nc-cron-secret");
  if (CONFIG.cronSecret && given && safeEqual(given, CONFIG.cronSecret)) return { mode: "cron" };

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return null;
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data.user) return null;
  const { data: admin } = await db
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return admin ? { mode: "admin", userId: data.user.id } : null;
}

// ------------------------------------------------------------- formatting ----
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function fmtDateTime(iso: string | null, lang: "vi" | "en"): string {
  if (!iso) return lang === "vi" ? "không rõ" : "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return lang === "vi" ? "không rõ" : "unknown";
  const text = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", {
    timeZone: CONFIG.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  return `${text} (GMT+7)`;
}

function fmtDuration(minutes: number, lang: "vi" | "en"): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (lang === "vi") return h > 0 ? `${h} giờ${r ? ` ${r} phút` : ""}` : `${r} phút`;
  return h > 0 ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / 60000;
}

function travelMode(mode: string | null, lang: "vi" | "en"): string {
  const labels: Record<string, [string, string]> = {
    motorbike: ["Xe máy (đường đèo)", "Motorbike (mountain pass)"],
    hiking: ["Đi bộ / trekking", "Hiking / trekking"],
    mixed: ["Kết hợp", "Mixed"],
  };
  const pair = mode ? labels[mode] : undefined;
  if (!pair) return mode ?? (lang === "vi" ? "không rõ" : "unknown");
  return lang === "vi" ? pair[0] : pair[1];
}

function validCoords(s: AlertPayload): boolean {
  return typeof s.last_lat === "number" && typeof s.last_lng === "number" &&
    Number.isFinite(s.last_lat) && Number.isFinite(s.last_lng) &&
    Math.abs(s.last_lat) <= 90 && Math.abs(s.last_lng) <= 180;
}

function mapLinks(s: AlertPayload): { google: string; osm: string; text: string } | null {
  if (!validCoords(s)) return null;
  const lat = (s.last_lat as number).toFixed(5);
  const lng = (s.last_lng as number).toFixed(5);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`,
    text: `${lat}, ${lng}`,
  };
}

// --------------------------------------------------------------- e-mail ----
const COLORS = {
  danger: "#E5484D",
  primary: "#0E9384",
  text: "#0F1F1E",
  text2: "#405654",
  muted: "#728785",
  border: "#D8E5E4",
  soft: "#F3F7F7",
  warnSoft: "#FFF6E0",
};

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function buildEmail(s: AlertPayload): EmailContent {
  const name = s.traveler_name || "Người dùng NomadCare";
  const nameEn = s.traveler_name || "A NomadCare user";
  const recipient = s.recipient_name || "";
  const resolved = s.type === "resolved";
  const accent = resolved ? COLORS.primary : COLORS.danger;
  const links = mapLinks(s);
  const sinceCheckin = minutesSince(s.last_checkin_at);
  const route = s.route_name || s.route_id || "—";
  const routeEn = s.route_name_en || s.route_name || s.route_id || "—";

  // ---- headline per reason
  const headline: Record<Reason, [string, string]> = {
    overdue: [
      `${name} chưa check-in đúng hẹn`,
      `${nameEn} missed a scheduled check-in`,
    ],
    sos: [`SOS: ${name} vừa gửi tín hiệu cầu cứu`, `SOS: ${nameEn} sent an SOS`],
    manual: [`Cảnh báo an toàn về ${name}`, `Safety alert about ${nameEn}`],
    resolved: [`${name} đã an toàn`, `All clear: ${nameEn} is safe`],
    contact_lost: [`Mất liên lạc bất thường với ${name}`, `Lost contact with ${nameEn}`],
  };
  const [titleVi, titleEn] = headline[s.reason] ?? headline.overdue;
  // SOS first in the subject: it is an emergency, not a missed check-in
  const subject = s.reason === "sos"
    ? `[NomadCare] SOS · ${titleVi.replace(/^SOS: /, "")} · ${titleEn.replace(/^SOS: /, "")}`
    : `[NomadCare] ${titleVi} · ${titleEn}`;

  const sinceSignal = minutesSince(s.last_heartbeat_at ?? null);
  const introVi = resolved
    ? `Tin tốt: ${name} đã check-in lại hoặc đã được xác nhận an toàn. Cảnh báo trước đó đã được đóng.`
    : s.reason === "contact_lost"
    ? `Ứng dụng NomadCare của ${name} đang mở và gửi tín hiệu định kỳ cho máy chủ, nhưng máy chủ không nhận được tín hiệu nào từ ` +
      `${fmtDateTime(s.last_heartbeat_at ?? null, "vi")}` + (sinceSignal !== null ? ` (${fmtDuration(sinceSignal, "vi")} trước)` : "") +
      `. Đây là mất kết nối bất thường, không phải vùng mất sóng dự kiến trên lộ trình.`
    : s.reason === "sos"
    ? `${name} đã bấm SOS trên ứng dụng NomadCare. Đây là vị trí và thông tin gần nhất mà hệ thống nhận được.`
    : s.reason === "manual"
    ? `Quản trị viên NomadCare gửi cảnh báo này vì chưa liên lạc được với ${name}.`
    : `${name} đã hẹn check-in định kỳ trên ứng dụng NomadCare nhưng đã quá hạn mà chưa check-in` +
      (sinceCheckin !== null ? ` (lần cuối cách đây ${fmtDuration(sinceCheckin, "vi")}).` : ".");
  const introEn = resolved
    ? `Good news: ${nameEn} has checked in again or was confirmed safe. The earlier alert is closed.`
    : s.reason === "contact_lost"
    ? `The NomadCare app of ${nameEn} was open and sending regular signals, but the server has heard nothing since ` +
      `${fmtDateTime(s.last_heartbeat_at ?? null, "en")}` + (sinceSignal !== null ? ` (${fmtDuration(sinceSignal, "en")} ago)` : "") +
      `. This is an abnormal loss of contact, not a no-signal area expected on the route.`
    : s.reason === "sos"
    ? `${nameEn} pressed SOS in the NomadCare app. Below is the latest location and information we received.`
    : s.reason === "manual"
    ? `A NomadCare administrator sent this alert because ${nameEn} could not be reached.`
    : `${nameEn} scheduled regular check-ins in the NomadCare app and is now overdue` +
      (sinceCheckin !== null ? ` (last check-in ${fmtDuration(sinceCheckin, "en")} ago).` : ".");

  // ---- detail rows [label vi, label en, value html, value text]
  const rows: Array<[string, string, string, string]> = [];
  const add = (vi: string, en: string, valueHtml: string, valueText: string) => rows.push([vi, en, valueHtml, valueText]);
  add("Lần check-in cuối", "Last check-in",
    `${esc(fmtDateTime(s.last_checkin_at, "vi"))}<br><span style="color:${COLORS.muted}">${esc(fmtDateTime(s.last_checkin_at, "en"))}</span>`,
    fmtDateTime(s.last_checkin_at, "vi"));
  if (!resolved && s.reason === "sos") {
    const sosAt = s.sos_at ?? s.server_time;
    add("Thời điểm bấm SOS", "SOS sent at",
      `<strong>${esc(fmtDateTime(sosAt, "vi"))}</strong><br><span style="color:${COLORS.muted}">${esc(fmtDateTime(sosAt, "en"))}</span>`,
      fmtDateTime(sosAt, "vi"));
  } else if (!resolved && s.reason === "contact_lost") {
    add("Tín hiệu cuối từ ứng dụng", "Last signal from the app",
      `<strong>${esc(fmtDateTime(s.last_heartbeat_at ?? null, "vi"))}</strong><br><span style="color:${COLORS.muted}">${esc(fmtDateTime(s.last_heartbeat_at ?? null, "en"))}</span>`,
      fmtDateTime(s.last_heartbeat_at ?? null, "vi"));
    add("Hạn check-in tiếp theo", "Next check-in due",
      `${esc(fmtDateTime(s.next_due_at, "vi"))}<br><span style="color:${COLORS.muted}">${esc(fmtDateTime(s.next_due_at, "en"))}</span>`,
      fmtDateTime(s.next_due_at, "vi"));
  } else if (!resolved) {
    add("Hạn check-in", "Check-in was due",
      `${esc(fmtDateTime(s.next_due_at, "vi"))} · ${esc(`chu kỳ ${s.interval_min} phút, ân hạn ${s.grace_min} phút`)}` +
        `<br><span style="color:${COLORS.muted}">every ${s.interval_min} min, grace ${s.grace_min} min</span>`,
      `${fmtDateTime(s.next_due_at, "vi")} (${s.interval_min}/${s.grace_min} min)`);
  }
  if (links) {
    add("Vị trí cuối", "Last known location",
      `<strong>${esc(links.text)}</strong><br><span style="color:${COLORS.muted}">${esc(fmtDateTime(s.last_location_at, "vi"))}</span>`,
      `${links.text} (${fmtDateTime(s.last_location_at, "vi")})`);
  } else {
    add("Vị trí cuối", "Last known location", "Chưa có vị trí · No location received", "Chưa có vị trí / No location");
  }
  add("Cung đường", "Route",
    `${esc(route)}${routeEn !== route ? `<br><span style="color:${COLORS.muted}">${esc(routeEn)}</span>` : ""}`,
    route);
  add("Phương tiện", "Travel mode",
    `${esc(travelMode(s.travel_mode, "vi"))}<br><span style="color:${COLORS.muted}">${esc(travelMode(s.travel_mode, "en"))}</span>`,
    travelMode(s.travel_mode, "vi"));
  if (resolved && s.resolved_note) add("Ghi chú", "Note", esc(s.resolved_note), s.resolved_note);

  const rowsHtml = rows.map(([vi, en, v]) => `
          <tr>
            <td valign="top" style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};width:38%;font-size:13px;color:${COLORS.text2}">
              <strong>${esc(vi)}</strong><br><span style="color:${COLORS.muted}">${esc(en)}</span>
            </td>
            <td valign="top" style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};font-size:14px;color:${COLORS.text}">${v}</td>
          </tr>`).join("");

  // ---- consented public medical layer (never identity data)
  const med = !resolved && s.share_public_medical && s.public_medical ? s.public_medical : null;
  const medRows: Array<[string, string, string | undefined]> = med
    ? [
      ["Nhóm máu", "Blood type", med.blood_type],
      ["Dị ứng", "Allergies", med.allergies],
      ["Bệnh nền", "Conditions", med.conditions],
      ["Thuốc đang dùng", "Medications", med.medications],
      ["Ghi chú", "Notes", med.notes],
    ].filter((r): r is [string, string, string] => !!r[2] && r[2] !== "unknown")
    : [];
  const medHtml = medRows.length
    ? `
      <tr><td style="padding:20px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COLORS.warnSoft};border-radius:12px">
          <tr><td colspan="2" style="padding:12px 12px 4px;font-size:14px;color:${COLORS.text}">
            <strong>Hồ sơ y tế công khai</strong> · <span style="color:${COLORS.text2}">Public medical profile</span><br>
            <span style="font-size:12px;color:${COLORS.muted}">Người dùng đã đồng ý chia sẻ phần này · shared with the user's consent</span>
          </td></tr>
          ${medRows.map(([vi, en, v]) => `
          <tr>
            <td valign="top" style="padding:6px 12px;width:38%;font-size:13px;color:${COLORS.text2}"><strong>${esc(vi)}</strong> · ${esc(en)}</td>
            <td valign="top" style="padding:6px 12px;font-size:14px;color:${COLORS.text}">${esc(v)}</td>
          </tr>`).join("")}
          <tr><td colspan="2" style="height:8px"></td></tr>
        </table>
      </td></tr>`
    : "";

  const button = (href: string, label: string, bg: string) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener" style="display:inline-block;margin:4px 8px 4px 0;padding:12px 18px;border-radius:10px;background:${bg};color:#FFFFFF;font-size:14px;font-weight:bold;text-decoration:none">${esc(label)}</a>`;
  const mapsHtml = links
    ? `<tr><td style="padding:16px 24px 0">
        ${button(links.google, "Mở Google Maps · Open in Google Maps", accent)}
        ${button(links.osm, "OpenStreetMap", COLORS.text2)}
      </td></tr>`
    : "";

  // Guidance (plain strings; HTML variants add <strong> and escape the name).
  const guidance = (lang: "vi" | "en", html: boolean): string[] => {
    const n = html ? esc(lang === "vi" ? name : nameEn) : (lang === "vi" ? name : nameEn);
    const b = (t: string) => (html ? `<strong>${t}</strong>` : t);
    if (resolved) {
      return [lang === "vi"
        ? "Không cần làm gì thêm. Cảm ơn bạn đã là người đồng hành an toàn."
        : "Nothing else to do. Thank you for being a safety buddy."];
    }
    return lang === "vi"
      ? [
        `Thử gọi điện hoặc nhắn tin cho ${n} ngay.`,
        `Nếu không liên lạc được: gọi ${b("112")} (tìm kiếm cứu nạn) hoặc ${b("115")} (cấp cứu) và đọc vị trí cuối ở trên.`,
        `Báo công an xã/huyện (${b("113")}) hoặc kiểm lâm địa phương nơi có vị trí cuối, nhất là khi ở đèo, rừng hoặc vùng mất sóng.`,
        "Không tự đi tìm một mình vào vùng mất sóng. Cuộc gọi khẩn cấp vẫn có thể đi qua mạng khác nếu có sóng.",
      ]
      : [
        `Try calling or messaging ${n} right away.`,
        `If you cannot reach them: call ${b("112")} (search ${html ? "&amp;" : "&"} rescue) or ${b("115")} (ambulance) in Vietnam and give the last location above.`,
        `Contact the local police (${b("113")}) or forest rangers near the last location, especially for passes, forests or no-signal areas.`,
        "Do not search alone inside a no-signal area. Emergency calls can roam to any network that has signal.",
      ];
  };
  const list = (items: string[]) =>
    `<ol style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.55;color:${COLORS.text}">${
      items.map((i) => `<li style="margin:0 0 6px">${i}</li>`).join("")
    }</ol>`;

  const preheader = resolved ? `${titleVi}. ${titleEn}.` : `${titleVi}. ${links ? `Vị trí cuối ${links.text}. ` : ""}${titleEn}.`;

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.soft};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.soft}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;border:1px solid ${COLORS.border};border-collapse:separate;overflow:hidden">
      <tr><td style="background:${accent};padding:18px 24px;color:#FFFFFF">
        <div style="font-size:13px;letter-spacing:.5px;text-transform:uppercase;opacity:.9">NomadCare · Buddy Check-in</div>
        <div style="font-size:22px;font-weight:bold;line-height:1.3;margin-top:6px">${esc(titleVi)}</div>
        <div style="font-size:15px;line-height:1.4;opacity:.92">${esc(titleEn)}</div>
      </td></tr>
      <tr><td style="padding:20px 24px 0;font-size:15px;line-height:1.55;color:${COLORS.text}">
        ${recipient ? `<p style="margin:0 0 10px">Chào ${esc(recipient)},</p>` : ""}
        <p style="margin:0 0 10px">${esc(introVi)}</p>
        <p style="margin:0;color:${COLORS.text2}">${recipient ? `Hi ${esc(recipient)}, ` : ""}${esc(introEn)}</p>
      </td></tr>
      <tr><td style="padding:16px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COLORS.border};border-radius:12px">
          ${rowsHtml}
        </table>
      </td></tr>
      ${mapsHtml}
      ${medHtml}
      <tr><td style="padding:20px 24px 0">
        <div style="font-size:15px;font-weight:bold;color:${COLORS.text}">${resolved ? "Tiếp theo" : "Bạn nên làm gì"}</div>
        ${list(guidance("vi", true))}
        <div style="font-size:15px;font-weight:bold;color:${COLORS.text};margin-top:14px">${resolved ? "Next" : "What you should do"}</div>
        ${list(guidance("en", true))}
      </td></tr>
      <tr><td style="padding:20px 24px 24px;font-size:12px;line-height:1.5;color:${COLORS.muted}">
        <hr style="border:none;border-top:1px solid ${COLORS.border};margin:0 0 12px">
        Email tự động từ NomadCare vì ${esc(name)} đã chọn bạn làm người nhận cảnh báo. NomadCare không xác nhận được tình trạng thực tế của người dùng; thông tin trên là dữ liệu cuối cùng thiết bị gửi được.<br>
        Automated e-mail from NomadCare: ${esc(nameEn)} chose you as their safety contact. NomadCare cannot confirm the person's actual condition; the data above is the last the device could send.<br>
        <span style="color:${COLORS.border}">Mã phiên · Session: ${esc(s.id)}</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `NomadCare · Buddy Check-in`,
    `${titleVi}`,
    `${titleEn}`,
    ``,
    recipient ? `Chào ${recipient},` : "",
    introVi,
    introEn,
    ``,
    ...rows.map(([vi, en, , t]) => `${vi} / ${en}: ${t}`),
    links ? `Google Maps: ${links.google}` : "",
    links ? `OpenStreetMap: ${links.osm}` : "",
    medRows.length ? `\nHồ sơ y tế công khai / Public medical profile:` : "",
    ...medRows.map(([vi, en, v]) => `- ${vi} / ${en}: ${v}`),
    ``,
    resolved ? "Tiếp theo / Next:" : "Bạn nên làm gì / What you should do:",
    ...guidance("vi", false).map((g, i) => `${i + 1}. ${g}`),
    ...guidance("en", false).map((g, i) => `${i + 1}. ${g}`),
    ``,
    `Session: ${s.id}`,
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");

  return { subject, html, text };
}

// --------------------------------------------------------------- Resend ----
async function sendEmail(s: AlertPayload, email: EmailContent): Promise<SendResult> {
  if (CONFIG.dryRun) return { ok: true, provider: "dry-run", id: `dry-run-${crypto.randomUUID()}` };
  if (isReservedRecipient(s.recipient_email)) return { ok: true, provider: "demo", id: `demo-${crypto.randomUUID()}` };
  if (!CONFIG.resendKey) return { ok: false, provider: "resend", error: "RESEND_API_KEY is not set" };

  const claim = Date.parse(s.claim_at);
  const idempotencyKey = `nc-${s.id}-${s.type}-${Number.isNaN(claim) ? Date.now() : claim}`;
  const payload: Record<string, unknown> = {
    from: CONFIG.from,
    to: [s.recipient_email],
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: [{ name: "type", value: s.type }, { name: "reason", value: s.reason }],
  };
  if (CONFIG.replyTo) payload.reply_to = CONFIG.replyTo;

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CONFIG.resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      return { ok: false, provider: "resend", error: `network: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { id?: string };
      return { ok: true, provider: "resend", id: body.id ?? "" };
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const wait = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 5) * 1000 : 1200);
      continue;
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, provider: "resend", error: `Resend HTTP ${res.status}: ${detail}` };
  }
  return { ok: false, provider: "resend", error: "Resend: retries exhausted" };
}

// -------------------------------------------------------------- handler ----
Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  if (!CONFIG.supabaseUrl || !CONFIG.serviceKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500, cors);
  }

  const db = createClient(CONFIG.supabaseUrl, CONFIG.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const caller = await authenticate(req, db).catch(() => null);
  if (!caller) return json({ ok: false, error: "unauthorized" }, 401, cors);

  // ---- body
  let body: { session_id?: unknown; type?: unknown; inline?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, cors);
  }
  const sessionId = typeof body.session_id === "string" && body.session_id ? body.session_id : null;
  const type: AlertType = body.type === "resolved" ? "resolved" : "overdue";
  if (sessionId && !UUID_RE.test(sessionId)) return json({ ok: false, error: "invalid_session_id" }, 400, cors);
  // inline all-clear of an erased device: only from the database (cron secret)
  const inline = caller.mode === "cron" && type === "resolved" ? inlinePayload(body.inline) : null;
  if (type === "resolved" && !sessionId && !inline) return json({ ok: false, error: "session_id_required" }, 400, cors);

  const trigger = caller.mode === "admin" ? "manual" : "cron";
  const force = caller.mode === "admin" && !!sessionId;
  // the admin behind a manual alert (audit log + event meta), never for cron
  const actor = caller.mode === "admin" ? { p_actor: caller.userId } : {};

  // ---- claim (atomic in SQL: eligibility, backoff, abuse quota, no double send)
  let sessions: AlertPayload[];
  if (inline) {
    sessions = [inline];
  } else {
    const { data: claimed, error: claimError } = await rpcCompat(db, "nc_alert_claim", {
      p_session_id: sessionId,
      p_type: type,
      p_force: force,
      p_limit: CONFIG.batchLimit,
    }, actor);
    if (claimError) {
      console.error("nc_alert_claim failed", claimError.message);
      return json({ ok: false, error: "claim_failed", detail: claimError.message }, 500, cors);
    }
    sessions = (Array.isArray(claimed) ? claimed : []) as AlertPayload[];
  }

  // ---- send one by one (Resend rate limit), record every outcome
  const results: Array<{ session_id: string; status: "sent" | "failed"; provider: string; reason: Reason; id?: string; error?: string }> = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (i > 0 && !CONFIG.dryRun) await sleep(CONFIG.resendGapMs);
    let outcome: SendResult;
    try {
      outcome = await sendEmail(s, buildEmail(s));
    } catch (err) {
      outcome = { ok: false, provider: "resend", error: err instanceof Error ? err.message : String(err) };
    }
    if (!inline) {   // an inline all-clear has no row left to update
      const { error: recordError } = await rpcCompat(db, "nc_alert_result", {
        p_session_id: s.id,
        p_ok: outcome.ok,
        p_type: type,
        p_provider: outcome.provider,
        p_provider_id: outcome.id ?? null,
        p_error: outcome.error ?? null,
        p_trigger: trigger,
      }, { ...actor, p_reason: s.reason });
      if (recordError) console.error("nc_alert_result failed", s.id, recordError.message);
    }
    results.push(outcome.ok
      ? { session_id: s.id, status: "sent", provider: outcome.provider, reason: s.reason, id: outcome.id }
      : { session_id: s.id, status: "failed", provider: outcome.provider, reason: s.reason, error: outcome.error });
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const firstFailure = results.find((r) => r.status === "failed");
  const summary = {
    // a failed e-mail means the recipient was NOT notified: never report it as ok
    ok: !firstFailure,
    mode: caller.mode,
    type,
    processed: results.length,
    sent,
    failed: results.length - sent,
    dry_run: CONFIG.dryRun,
    ...(firstFailure ? { error: firstFailure.error ?? "send_failed" } : {}),
    results,
  };
  // no personal data in logs: ids and counts only
  console.log("deadman-alert", JSON.stringify({ mode: caller.mode, type, processed: results.length, sent, inline: !!inline }));
  return json(summary, 200, cors);
});
