# NomadCare v2: tầng máy chủ Supabase

Thư mục này chứa toàn bộ backend của NomadCare: PostgreSQL + PostGIS trên Supabase, hàm RPC cho ứng dụng và dashboard, cron dead-man switch, Edge Function `deadman-alert` gửi email cảnh báo qua Resend và (tuỳ chọn) Edge Function `push-dispatch` gửi Web Push nhắc trước vùng mất sóng. Làm đủ 8 bước dưới đây (bước 7 tuỳ chọn) trên một project miễn phí mất khoảng 20–30 phút.

Ứng dụng vẫn chạy khi chưa có Supabase: để trống `supabaseUrl` trong `assets/js/config.js` thì app dùng máy chủ mô phỏng trong trình duyệt. Ở chế độ đó mọi email chỉ là mô phỏng và không có Web Push.

## Có gì trong thư mục

| Đường dẫn | Nội dung |
|---|---|
| `migrations/20260927000100_extensions.sql` | postgis, pgcrypto (bắt buộc); pg_cron, pg_net (tuỳ chọn, thiếu thì bỏ qua); schema `app_private` |
| `migrations/…0200_schema.sql` | 18 bảng, ràng buộc CHECK, chỉ mục GiST/B-tree, trigger `updated_at` |
| `migrations/…0300_views.sql` | `v_facilities`, `v_buddy_sessions`, `v_services`, `v_signal_samples` (security_invoker) |
| `migrations/…0400_rls.sql` | RLS cho mọi bảng, `is_admin()`, phân quyền anon / authenticated / service_role |
| `migrations/…0500_rpc_public.sql` | RPC công khai: gói dữ liệu, điểm y tế gần nhất, đăng ký thiết bị, đồng bộ outbox |
| `migrations/…0600_rpc_admin.sql` | RPC quản trị: KPI, phát hành gói, duyệt đóng góp, duyệt nội dung y tế |
| `migrations/…0700_audit.sql` | Nhật ký thao tác (`audit_log`) bằng trigger |
| `migrations/…0800_cron.sql` | Phát hiện quá hạn, gọi Edge Function, lịch pg_cron mỗi phút |
| `migrations/…0900_realtime.sql` | Realtime cho dashboard, siết quyền lần cuối |
| `migrations/20260928000100_hardening.sql` | Đợt 3: lọc tên, giới hạn chống lạm dụng, `alert_reason` (SOS), op `buddy.update` và `device.erase`, thời hạn lưu, `admin_pack_changes`, phát hành không đổi thì giữ version, kiểm tra ngày và toạ độ điểm y tế, realtime thêm 4 bảng (quy tắc "bắt buộc email" của đợt này đã được 20260930000100 thay) |
| `migrations/20260929000100_quota_ledger.sql` | Đợt 3d: sổ ghi email cảnh báo `app_private.alert_ledger` (giới hạn không còn bị `device.erase` xoá, tính cả email "đã an toàn", gộp bí danh Gmail), cột `routes.region_en` trong `list_routes()` và gói dữ liệu |
| `migrations/20260930000100_buddy_phone_required.sql` | Vòng 2 (R7): SĐT người nhận bắt buộc, chuẩn hoá E.164 (`app_private.norm_phone`), email không bắt buộc; giới hạn 5 phiên/thiết bị/24 giờ chỉ tính phiên có email thật |
| `migrations/20260930000200_trip_heartbeat_push.sql` | Vòng 2 (R6): op `buddy.heartbeat`, phát hiện mất liên lạc (`alert_reason = 'contact_lost'`), bảng `push_subscriptions` / `push_schedule`, op `push.*`, `nc_push_tick` + cron `nomadcare-push` |
| `migrations/20261002000100_buddy_mobile_only.sql` | 02/10/2026: SĐT người nhận phải là số di động (`app_private.phone_is_landline`, `valid_phone`); phiên mới với số máy bàn 02x bị từ chối `recipient_phone_not_mobile`, phiên cũ đã lưu số máy bàn vẫn chạy |
| `setup_all.sql` | Gộp 14 file trên theo thứ tự (sinh tự động bởi `tools/db-test/run.sh`) |
| `seed.sql` | Dữ liệu minh hoạ 3 cung đường (do `tools/seed/build_seed.py` sinh) |
| `functions/deadman-alert/index.ts` | Edge Function gửi email song ngữ Việt–Anh |
| `functions/push-dispatch/index.ts` | Edge Function gửi Web Push nhắc trước vùng mất sóng (tuỳ chọn) |
| `config.toml` | Cấu hình cho Supabase CLI (tuỳ chọn; chỉ khai báo `deadman-alert`) |

Chạy lại **cả bộ** theo thứ tự tên (hoặc dán lại `setup_all.sql`) bao nhiêu lần cũng an toàn: không mất dữ liệu, không đổi `app_private.settings`. **Không chạy lại riêng một file cũ** (ví dụ chỉ `0800_cron.sql` hay `0900_realtime.sql`). Các file sau đã thay nhiều hàm của file trước, nên chạy riêng file cũ sẽ đưa hàm cũ trở lại hoặc thu lại quyền đã cấp. Ví dụ, chạy lại riêng 0800 thì mất kiểm tra hạn mức email, và `nc_alert_claim` có thêm bản 4 tham số nên mọi email do cron gửi lỗi `claim_failed`.

## Bước 1. Tạo project

1. Đăng ký tại https://supabase.com, chọn **New project**.
2. Đặt tên (ví dụ `nomadcare`), đặt mật khẩu database và lưu lại, chọn region Singapore (`ap-southeast-1`) vì gần Việt Nam nhất.
3. Chờ project khởi tạo xong (1–2 phút).

Project gói Free sẽ tạm dừng nếu không có truy cập trong 7 ngày. Trước buổi demo, mở dashboard kiểm tra và bấm Restore nếu cần.

## Bước 2. Chạy migrations

Cách A, dùng SQL Editor (không cần cài gì):

1. Vào **SQL Editor → New query**.
2. Mở `supabase/setup_all.sql`, dán toàn bộ, bấm **Run**. Kết quả mong đợi: `Success. No rows returned`.
3. Nếu muốn chạy từng file, dán lần lượt 14 file trong `migrations/` theo đúng thứ tự tên.

**Nâng cấp project đã cài.** Chạy các file còn thiếu theo đúng thứ tự tên (hoặc dán lại cả `setup_all.sql`), rồi `notify pgrst, 'reload schema';`:

- Cài từ trước đợt 3: thêm `20260928000100_hardening.sql` và mọi file sau nó, rồi deploy lại Edge Function ở bước 6. Function mới vẫn chạy được với database cũ (tự gọi lại RPC theo chữ ký cũ), nhưng khi đó nhật ký không ghi được tên admin đã bấm "Gửi cảnh báo ngay".
- Đã chạy `20260928000100_hardening.sql`: thêm `20260929000100_quota_ledger.sql`. Migration tự chép các email đã gửi trong 48 giờ qua vào sổ ghi, và điền `region_en` cho 3 cung đường mẫu. Gói dữ liệu đã phát hành trước đó chưa có `region_en` (ứng dụng hiển thị `region` thay thế); muốn có ngay thì phát hành lại: `select app_private.publish_all_packs('Thêm region_en');`.
- Đã chạy `20260929000100_quota_ledger.sql`: thêm `20260930000100_buddy_phone_required.sql` rồi `20260930000200_trip_heartbeat_push.sql`. Thiếu file 0100 thì server vẫn giữ `op_buddy_start` cũ: phiên chỉ có SĐT bị từ chối với `recipient_email_required`. Thiếu file 0200 thì op `buddy.heartbeat` / `push.*` lỗi `unknown_op` và không có phát hiện mất liên lạc. Sau đó deploy lại `deadman-alert` (bước 6) để có mẫu email `contact_lost`; function cũ gửi loại này bằng nội dung email quá hạn.
- Đã chạy `20260930000200_trip_heartbeat_push.sql`: thêm `20261002000100_buddy_mobile_only.sql`. Thiếu file này thì server vẫn nhận số máy bàn 02x cho phiên mới (app chặn trước, nhưng app bản cũ thì không). Không cần deploy lại Edge Function.

Cách B, dùng Supabase CLI:

```bash
supabase login
supabase link --project-ref <project-ref>     # ref nằm trong URL dashboard
supabase db push                              # chạy migrations/
```

## Bước 3. Nạp dữ liệu mẫu

1. SQL Editor → dán `supabase/seed.sql` → **Run** (hoặc `supabase db push --include-seed`).
2. Nếu `list_routes()` cho thấy các nhà mạng chưa có gói (`"packs": {"viettel": null, …}`), phát hành lần đầu cho mọi cung đường × nhà mạng:

```sql
select app_private.publish_all_packs('Phát hành lần đầu');
```

Toàn bộ điểm y tế và dịch vụ trong seed là dữ liệu minh hoạ (`is_demo = true`, số điện thoại dạng `+84 000 000 0NN`).

## Bước 4. Tạo tài khoản quản trị

1. **Authentication → Users → Add user → Create new user**: nhập email + mật khẩu, bật Auto Confirm.
2. Gán quyền admin trong SQL Editor:

```sql
insert into public.admin_users (user_id, display_name, role)
select id, 'Quản trị NomadCare', 'admin' from auth.users where email = 'ban@vidu.com'
on conflict (user_id) do update set role = excluded.role;
```

3. Tắt đăng ký tự do: **Authentication → Sign In / Providers**, tắt "Allow new users to sign up". Người lạ có tạo được tài khoản thì RLS vẫn không cho đọc gì, nhưng tắt đi cho gọn.

`role = 'reviewer'` cũng vào được dashboard; chỉ `role = 'admin'` mới thêm/xoá được admin khác.

## Bước 5. Bật cron dead-man switch

Server tự phát hiện phiên Buddy quá hạn và gửi email mà không cần điện thoại của người dùng có sóng. Cần hai extension:

1. **Database → Extensions**: bật `pg_cron` và `pg_net` (nếu đã bật trước bước 2 thì bỏ qua).
2. Nếu bật sau bước 2 (trường hợp hay gặp trên Supabase), chỉ cần tạo 3 lịch trong SQL Editor (chạy lại vẫn an toàn, lịch trùng tên được ghi đè):

```sql
select cron.schedule('nomadcare-deadman', '* * * * *',  'select public.nc_deadman_tick()');
select cron.schedule('nomadcare-cleanup', '17 3 * * *', 'select public.nc_cleanup()');
select cron.schedule('nomadcare-push',    '* * * * *',  'select public.nc_push_tick()');
```

Hoặc dán lại toàn bộ `setup_all.sql`. pg_net không cần chạy lại gì vì hàm kiểm tra pg_net lúc chạy. **Đừng** chạy lại riêng `0800_cron.sql`: làm thế sẽ đưa hàm dead-man cũ trở lại và cron không gửi được email (xem ghi chú ngay dưới bảng file ở đầu trang).

3. Tạo secret ngẫu nhiên và lưu cấu hình (thay `<project-ref>`):

```sql
select encode(extensions.gen_random_bytes(24), 'hex');   -- copy kết quả làm CRON_SECRET

insert into app_private.settings (key, value) values
  ('functions_url', 'https://<project-ref>.supabase.co/functions/v1'),
  ('cron_secret',   '<CRON_SECRET vừa tạo>')
on conflict (key) do update set value = excluded.value;
```

4. Kiểm tra lịch: `select jobname, schedule, command from cron.job;` phải có `nomadcare-deadman` (`* * * * *`), `nomadcare-cleanup` (hằng ngày) và `nomadcare-push` (`* * * * *`).

Mỗi phút, `nc_deadman_tick()` chuyển các phiên `active` đã quá `next_due_at + grace_min` sang `overdue`, gọi `nc_mark_contact_lost()` (phiên có tín hiệu `live` mà quá 15 phút không có heartbeat lẫn check-in, ngoài `silence_until`, chuyển sang `overdue` với `alert_reason = 'contact_lost'`; đổi ngưỡng bằng khoá `contact_lost_after_min` trong `app_private.settings`), rồi gọi Edge Function nếu có phiên cần báo. Phiên không có email chỉ hiện trên dashboard, không bao giờ được gửi. Không có pg_cron thì có thể gọi tay `select public.nc_deadman_tick();` hoặc bấm "Gửi cảnh báo ngay" trên dashboard.

Job `nomadcare-push` gọi `nc_push_tick()`: chỉ khi `push_schedule` có lời nhắc đến hạn mới gọi Edge Function `push-dispatch` (bước 7). App chưa có `vapidPublicKey` thì không gửi lịch nhắc nào, nên job không gọi gì. Không có pg_cron thì Web Push không chạy; lời nhắc vẫn hiện trong app khi app mở.

Job hằng ngày `nomadcare-cleanup` gọi `nc_cleanup()` để xoá dữ liệu hết hạn lưu (xem mục "Quyền riêng tư"). Không có pg_cron thì chạy tay `select public.nc_cleanup();` định kỳ.

## Bước 6. Deploy Edge Function `deadman-alert`

Tạo API key Resend trước: đăng ký https://resend.com → API Keys → Create. Với địa chỉ gửi mặc định `onboarding@resend.dev`, Resend chỉ cho gửi tới email của chính tài khoản Resend. Muốn gửi tới người nhận bất kỳ, xác minh một tên miền trong Resend rồi đặt `ALERT_FROM` theo tên miền đó.

Cách A, dashboard:

1. **Edge Functions → Deploy a new function → Via Editor**, đặt tên đúng `deadman-alert`.
2. Dán nội dung `functions/deadman-alert/index.ts`, bấm Deploy.
3. Trong phần cài đặt của function, tắt kiểm tra JWT (mục "Verify JWT" / "Enforce JWT verification"). Function tự kiểm tra quyền: header `x-nc-cron-secret` hoặc JWT của một admin.
4. **Edge Functions → Secrets**, thêm:

| Secret | Giá trị |
|---|---|
| `RESEND_API_KEY` | key Resend (`re_…`) |
| `CRON_SECRET` | giống hệt `cron_secret` ở bước 5 |
| `ALERT_FROM` | tuỳ chọn, mặc định `NomadCare <onboarding@resend.dev>` |
| `ALLOWED_ORIGINS` | tuỳ chọn, origin của dashboard, ví dụ `https://nomadcare.vercel.app` (mặc định `*`) |
| `ALERT_REPLY_TO` | tuỳ chọn |
| `ALERT_DRY_RUN` | `1` để demo không gửi email thật (vẫn ghi sự kiện `alert_sent`) |

Người nhận có tên miền dành riêng (`example.com`, `*.test`, `*.invalid`…, như các phiên demo trong seed) không bao giờ được gửi thật: function giả lập việc gửi và ghi `provider = 'demo'`, giống máy chủ mô phỏng cục bộ.

Cách B, CLI:

```bash
supabase functions deploy deadman-alert --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_xxx CRON_SECRET=<secret> ALERT_FROM="NomadCare <alert@ten-mien-cua-ban.vn>"
```

Thử gọi (phải trả JSON `{"ok":true,…,"processed":0}` khi chưa có phiên quá hạn):

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/deadman-alert" \
  -H "x-nc-cron-secret: <secret>" -H "Content-Type: application/json" -d '{}'
```

Tiêu đề và nội dung từng loại email (quá hạn, SOS, mất liên lạc, thủ công, "đã an toàn"), phần nào chỉ có ở bản HTML, và những gì không bao giờ có trong email: xem mục "Email cảnh báo chứa gì?" trong [`README.md`](../README.md). Chỉ phiên có email người nhận mới được gửi; phiên chỉ có SĐT không bao giờ được Edge Function chọn. Khi người đi check-in lại (hoặc admin đóng sự cố), người nhận nhận thêm email "đã an toàn".

Khi người đi bấm SOS (hoặc điện thoại tự phát hiện quá hạn lúc mất sóng rồi đồng bộ lên), phiên chuyển ngay sang `overdue` và server gọi Edge Function luôn, không chờ lượt cron kế tiếp. Cột `buddy_sessions.alert_reason` ghi lý do: `sos`, `overdue` (quá hạn check-in) hoặc `contact_lost` (ứng dụng đang mở bỗng im lặng, do cron đặt); về `null` khi người đi check-in lại hoặc phiên đóng. Email `contact_lost` ghi giờ tín hiệu cuối của ứng dụng và hạn check-in tiếp theo, nói rõ đây là mất kết nối bất thường chứ không phải vùng mất sóng dự kiến. Email SOS có tiêu đề bắt đầu bằng `[NomadCare] SOS ·`, ghi thời điểm bấm SOS thay cho hạn check-in, và không nhắc tới "chưa check-in". Nếu người nhận đã nhận email quá hạn rồi người đi mới bấm SOS, server gửi thêm một email SOS.

Kết quả trả về có `results[]` cho từng phiên: `{session_id, status: 'sent' | 'failed', provider, reason, id?, error?}`. Chỉ cần một email lỗi (ví dụ thiếu `RESEND_API_KEY`) là `ok = false` và `error` chứa lỗi đầu tiên, để dashboard phân biệt "gửi thất bại" với "không có phiên nào cần gửi" (`processed = 0`). Khi admin bấm "Gửi cảnh báo ngay", function chuyển `user id` của admin vào `nc_alert_claim` / `nc_alert_result`, nên `audit_log` và sự kiện `alert_sent` ghi tên admin đó chứ không phải `system`.

## Bước 7 (tuỳ chọn). Deploy Edge Function `push-dispatch` (Web Push)

Lời nhắc "sắp vào vùng mất sóng" chạy bằng hẹn giờ trong app, nên chỉ hiện khi app còn mở. Bước này cho phép máy chủ đẩy lời nhắc đúng giờ cả khi app đã đóng. Bỏ qua bước này thì để trống `vapidPublicKey` và mọi thứ khác vẫn chạy.

1. Tạo một cặp khoá VAPID (một lần): `npx web-push generate-vapid-keys`.
2. Deploy `functions/push-dispatch/index.ts` với tên đúng `push-dispatch` và **tắt kiểm tra JWT**, như `deadman-alert`. Function chỉ nhận header `x-nc-cron-secret` (do `nc_push_tick()` gửi qua pg_net). `config.toml` đã khai báo `verify_jwt = false` cho cả hai function; lệnh dưới vẫn thêm `--no-verify-jwt` cho chắc.
3. Thêm secrets:

| Secret | Giá trị |
|---|---|
| `VAPID_PUBLIC_KEY` | khoá công khai (base64url), giống `vapidPublicKey` trong `config.js` |
| `VAPID_PRIVATE_KEY` | khoá bí mật, không bao giờ đưa vào app |
| `VAPID_SUBJECT` | liên hệ của bên gửi: `mailto:ban@vidu.com` hoặc một URL `https://` (mặc định `mailto:nomadcare@example.org`) |
| `CRON_SECRET` | giống hệt `cron_secret` ở bước 5 (dùng chung với `deadman-alert`) |
| `PUSH_DRY_RUN` | tuỳ chọn, `1` để không gọi dịch vụ push mà vẫn ghi lời nhắc là đã gửi (demo) |

4. Điền khoá công khai vào `assets/js/config.js`: `vapidPublicKey: '<VAPID_PUBLIC_KEY>'`.

```bash
supabase functions deploy push-dispatch --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT="mailto:ban@vidu.com"
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/push-dispatch" \
  -H "x-nc-cron-secret: <secret>" -H "Content-Type: application/json" -d '{}'   # {"ok":true,"processed":0,…}
```

Luồng chạy: sau khi người dùng cho phép thông báo, app đăng ký `PushManager` và gửi op `push.subscribe`; mỗi chuyến đi gửi op `push.schedule` (tối đa 20 lời nhắc trong 48 giờ tới, thay toàn bộ lịch cũ; tắt công tắc "Thông báo hệ thống" thì gửi lịch rỗng). Mỗi phút `nc_push_tick()` gọi `push-dispatch` khi có lời nhắc đến hạn; function lấy lời nhắc bằng `nc_push_claim()`, gửi Web Push (VAPID), ghi kết quả bằng `nc_push_result()` và xoá các endpoint trả 404 / 410. Lời nhắc trễ quá 30 phút bị bỏ, tối đa 3 lần thử. Nội dung đẩy chung chung, không có toạ độ hay tên ("Khoảng N phút nữa. Mở NomadCare để gửi toạ độ cho người thân."). Function chỉ POST tới dịch vụ push của trình duyệt (FCM, Mozilla, Apple, Windows), cùng quy tắc với `app_private.valid_push_endpoint`. Trên iOS, Web Push chỉ có khi đã cài PWA ra màn hình chính.

## Bước 8. Nối ứng dụng với Supabase

Mở `assets/js/config.js`, điền hai giá trị lấy ở **Project Settings → API** (hoặc nút Connect trên dashboard):

```js
supabaseUrl: 'https://<project-ref>.supabase.co',
supabaseAnonKey: '<anon public key hoặc publishable key>',
vapidPublicKey: '<VAPID_PUBLIC_KEY>',   // chỉ khi đã làm bước 7; để trống = không dùng Web Push
```

Khoá anon được phép công khai vì anon không có quyền trên bảng nào, chỉ gọi được các RPC ở mục "Data API". Không bao giờ dán khoá `service_role` / secret key vào frontend. Khoá anon công khai vẫn đủ để một người lạ đăng ký thiết bị và bật phiên Buddy tới một địa chỉ email bất kỳ; mục "Bảo mật: khoá anon và email cảnh báo" mô tả các giới hạn chặn việc biến tính năng này thành máy gửi thư rác.

## Kiểm tra sau khi cài

Trong SQL Editor:

```sql
select jsonb_array_length(public.list_routes());                         -- 3
select public.get_data_pack('ha-giang-loop', 'viettel') ->> 'version';     -- ≥ 1 sau bước 3
select count(*) from public.facilities where status = 'verified';
select public.nc_deadman_tick();                                          -- {"marked_overdue":0,"contact_lost":0,"dispatched":0,…}
select public.nc_push_tick();                                             -- 0 (số lời nhắc đã chuyển cho push-dispatch)
```

Qua REST với khoá anon (thay biến):

```bash
URL=https://<project-ref>.supabase.co; KEY=<anon key>
curl -s "$URL/rest/v1/rpc/list_routes" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}' | head -c 300
curl -s "$URL/rest/v1/facilities?select=id&limit=1" -H "apikey: $KEY"      # phải bị từ chối (42501)
```

Trên ứng dụng:

- [ ] Mở `index.html`, bảng trạng thái mạng hiển thị backend "Supabase".
- [ ] MOD.02 tải được gói dữ liệu, kích thước khớp `size_bytes`.
- [ ] Đăng nhập `admin.html` bằng tài khoản bước 4, trang tổng quan hiện KPI.
- [ ] Phát hành gói mới trên dashboard, `list_routes()` tăng version.
- [ ] Bắt đầu phiên Buddy trên app với SĐT (bắt buộc) và email của bạn, rồi giả lập quá hạn:

```sql
update public.buddy_sessions set next_due_at = now() - interval '30 minutes'
where status = 'active' and recipient_email = 'ban@vidu.com';
```

  Sau tối đa 2 phút: trạng thái thành `alerted`, bảng `checkin_events` có `alert_sent`, hộp thư nhận email. Bấm check-in trên app: trạng thái về `active` và có email "đã an toàn". Một phiên chỉ có SĐT thì quá hạn vẫn hiện trên dashboard nhưng không có `alert_sent`.
- [ ] Mở app, bật Buddy và để app hiện trên màn hình: khi outbox đã gửi (thường dưới 30 giây), `buddy_sessions.last_heartbeat_at` có giá trị và `heartbeat_state = 'live'`; ẩn tab thì thành `paused`.
- [ ] Nếu đã làm bước 7: bấm *Bắt đầu đi* trên một lộ trình có vùng mất sóng, cho phép thông báo; `push_subscriptions` có một dòng và `push_schedule` có lời nhắc của chuyến đi.

## Data API

| Hàm | Ai gọi | Mô tả |
|---|---|---|
| `list_routes()` | anon, authenticated | Danh sách cung đường (tên và vùng tiếng Việt / tiếng Anh: `region`, `region_en`), độ chính xác theo nhà mạng, gói hiện hành |
| `get_data_pack(p_route_id, p_carrier)` | anon, authenticated | Gói đã phát hành (JSON Pack schema 1); chưa phát hành thì dựng trực tiếp |
| `build_data_pack(p_route_id, p_carrier)` | anon, authenticated | Dựng gói từ bảng hiện tại, không lưu |
| `nearest_facilities(p_lat, p_lng, p_limit, p_types)` | anon, authenticated | Điểm y tế đã xác thực gần nhất, chỉ xếp theo khoảng cách |
| `get_content_release()` | anon, authenticated | Phiên bản nội dung sơ cứu đã duyệt mới nhất |
| `register_device(p_carrier, p_app_version)` | anon, authenticated | Trả `{device_id, secret}`; server chỉ lưu sha256 của secret |
| `sync_device_ops(p_device_id, p_secret, p_ops)` | anon, authenticated | Đồng bộ outbox, idempotent theo id của op |
| `admin_kpis()`, `admin_review_submission`, `admin_review_samples`, `admin_resolve_session`, `admin_approve_content`, `admin_upsert_facility`, `admin_upsert_service` | authenticated + `is_admin()` | Dashboard |
| `admin_publish_pack(p_route_id, p_carrier, p_notes, p_force = false)` | authenticated + `is_admin()` | Phát hành phiên bản mới. Nội dung gói dựng lại giống hệt gói hiện hành (bỏ qua `version`, `published_at`, `size_bytes` và độ "cũ" của điểm y tế) thì không tăng version, trả phiên bản hiện hành kèm `unchanged: true`. `p_force = true` để vẫn phát hành |
| `admin_pack_changes(p_route_id?, p_carrier?)` | authenticated + `is_admin()` | Với từng cung đường × nhà mạng: `changed`, `count`, và danh sách điểm y tế / dịch vụ `added`, `removed` (kèm `reason`: `deleted`, `pending`, `rejected`, `inactive`, `moved`), `updated` (kèm các trường đổi) so với gói đang phát hành. Điểm bị báo đóng cửa hay bị xoá đều hiện ở đây |
| `nc_mark_overdue()`, `nc_mark_contact_lost()`, `nc_dispatch_alerts()`, `nc_deadman_tick()`, `nc_cleanup()` | pg_cron, admin | Dead-man switch, mất liên lạc, thời hạn lưu |
| `nc_push_tick()` | pg_cron, admin | Gọi `push-dispatch` khi có lời nhắc đến hạn |
| `nc_alert_claim(…, p_actor)`, `nc_alert_result(…, p_actor, p_reason)` | service_role | Chỉ Edge Function `deadman-alert` dùng |
| `nc_push_claim(p_limit)`, `nc_push_result(p_id, p_ok, p_error, p_gone)` | service_role | Chỉ Edge Function `push-dispatch` dùng |

Hàm tiện ích chỉ chạy trong SQL Editor: `app_private.publish_pack(route, carrier, notes)`, `app_private.publish_all_packs(notes)`.

Op mà `sync_device_ops` nhận: `device.register`, `buddy.start`, `buddy.checkin` (kind `checkin`, `location`, `pre_deadzone`, `sos`, `overdue`), `buddy.stop`, `buddy.resolve`, `buddy.update`, `buddy.heartbeat`, `push.subscribe`, `push.unsubscribe`, `push.schedule`, `report.submit`, `signal.log`, `device.erase`.

- `buddy.start` của một phiên mới **bắt buộc có số di động người nhận** (để người đi gửi SMS): số Việt Nam `0…` / `+84…` chỉ nhận di động (9 chữ số sau mã nước, đầu 3/5/7/8/9, tức `03x 05x 07x 08x 09x`), số quốc tế `+<mã nước>…` hoặc `00<mã nước>…` (8–15 chữ số; không có cách chung để phân biệt di động / cố định nên vẫn nhận), số demo `+84 000 000 0NN`; server lưu dạng E.164 (`app_private.norm_phone`). Thiếu thì lỗi `recipient_phone_required`, sai dạng thì `recipient_phone_invalid`, số máy bàn Việt Nam (`02x`, `+84 2…`, 10 chữ số sau mã nước) thì `recipient_phone_not_mobile` (từ `20261002000100`; `app_private.valid_phone` / `phone_is_landline`, cùng quy tắc với `normPhone()` của `backend-local.js`). Email không bắt buộc; có thì phải hợp lệ (`recipient_email_invalid`). Phiên không có email không bao giờ được gửi email (kể cả `contact_lost`): người đi dùng SMS soạn trên máy. Gửi lại `buddy.start` của một phiên server đã có (phiên cũ chỉ có email, hoặc phiên cũ đã lưu số máy bàn) thì được thiếu SĐT hoặc mang số máy bàn: server giữ SĐT đã lưu. Tên người đi và người nhận bị cắt còn 60 ký tự, bỏ ký tự điều khiển, URL, `http`, `www.`, địa chỉ email và tên miền (kết quả có cảnh báo `traveler_name_sanitized`). `started_at` gửi muộn từ outbox được giữ nguyên nhưng không lùi quá 24 giờ. Server cũ (chưa chạy 20260930000100) còn trả `recipient_email_required`.
- `buddy.heartbeat {session_id, state: 'live' | 'paused', lat?, lng?, accuracy_m?, silence_until?, client_ts}`: app gửi 5 phút/lần khi đang hiện trên màn hình và có mạng (`live`), và một lần `paused` khi ẩn / đóng. Server ghi `last_heartbeat_at` (giờ nhận), `heartbeat_state`, `silence_until` (tối đa 24 giờ tới) và cập nhật vị trí cuối nếu mới hơn; không tạo sự kiện; phiên đã đóng thì bỏ qua; trạng thái khác thì lỗi `invalid_state`.
- `push.subscribe {endpoint, p256dh, auth, lang}` (endpoint phải thuộc dịch vụ push của trình duyệt, nếu không lỗi `invalid_push_endpoint`; khoá sai thì `invalid_push_keys`; mỗi thiết bị giữ 5 đăng ký mới nhất), `push.unsubscribe {endpoint?}`, `push.schedule {items}` (thay toàn bộ lịch của thiết bị; tối đa 20 mục, quá thì `too_many_items`; mỗi mục `{fire_at, kind: 'deadzone_ahead', minutes_before 0–120, zone_km}`, sai thì `invalid_push_schedule`; mục đã qua hoặc xa hơn 48 giờ bị bỏ). Lịch không chứa toạ độ.
- `buddy.update {session_id, share_public_medical, public_medical?}` chỉ sửa lớp y tế công khai của phiên đang mở, không tạo sự kiện. `share_public_medical = false` thì server xoá `public_medical` (dùng khi người dùng rút lại đồng ý).
- `device.erase {client_ts}` đóng mọi phiên đang mở của thiết bị mà không gửi cảnh báo, xoá các phiên Buddy và sự kiện check-in của nó, xoá `device_ops` và bản ghi `devices`, gỡ `device_id` khỏi các đóng góp cộng đồng (cả trong ảnh chụp của `audit_log`). Nếu người nhận đã bị báo động mà chưa nhận email "đã an toàn", server gửi email đó trước khi xoá. Sổ ghi email cảnh báo (`app_private.alert_ledger`) không bị xoá: nó không chứa địa chỉ email hay mã thiết bị, và là căn cứ của giới hạn chống lạm dụng. Gửi lại `device.erase` cho một thiết bị không còn tồn tại vẫn trả `{erased: true, already_erased: true}`, để điện thoại xoá được "bia mộ" xoá dữ liệu đã lưu khi offline. Mọi op đứng sau `device.erase` trong cùng lô nhận lỗi `device_erased`.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `type "geography" does not exist` | PostGIS chưa bật | Bật `postgis` ở Database → Extensions rồi dán lại toàn bộ `setup_all.sql` (không chạy riêng file 0100 trên database đã cài: nó thu quyền `usage` trên `app_private` của `authenticated`) |
| App báo `permission denied` khi đọc bảng | Đúng thiết kế với anon | App phải đi qua RPC; kiểm tra `supabaseAnonKey` đúng project |
| Dashboard trả `forbidden` | Tài khoản chưa có trong `admin_users` | Làm lại bước 4 |
| `PGRST202` / không tìm thấy hàm | Cache schema của API chưa làm mới | Chạy `notify pgrst, 'reload schema';` |
| Cron không chạy | pg_cron chưa bật hoặc bật sau migrations | `select * from cron.job_run_details order by start_time desc limit 10;`; thiếu lịch thì tạo 3 lịch như bước 5 mục 2 (không chạy riêng file 0800) |
| Có phiên `overdue` nhưng không có email | Phiên không có email người nhận (đúng thiết kế: chỉ hiện trên dashboard), `functions_url` sai, JWT verification còn bật, hoặc secret lệch | Kiểm tra `recipient_email` của phiên; `select status_code, content::text, error_msg from net._http_response order by created desc limit 5;` 401 nghĩa là JWT verification bật hoặc `CRON_SECRET` khác `cron_secret` |
| Resend trả 403 "only send testing emails to your own email" | Chưa xác minh tên miền | Dùng email của tài khoản Resend làm người nhận, xác minh tên miền, hoặc `ALERT_DRY_RUN=1` |
| Email lỗi liên tục | Key Resend sai | Server thử lại sau 2, 4, 8, 16, 32 phút, tối đa 6 lần mỗi giờ; sửa secret rồi bấm "Gửi cảnh báo ngay" |
| Dashboard không tự cập nhật | Bảng chưa nằm trong publication realtime | Database → Publications → `supabase_realtime`: bật `buddy_sessions`, `checkin_events`, `facilities`, `facility_submissions`, `signal_samples`, `services`, `data_packs`, `content_releases`, `audit_log`; hoặc dán lại toàn bộ `setup_all.sql` (không chạy riêng file 0900: nó thu quyền `authenticated` trên `buddy_session_defaults()` mà các file sau đã cấp) |
| Thêm điểm y tế `verified` bị lỗi `23514` | Thiếu trường bắt buộc (PDF mục 8.1) | Điền đủ: tên, địa chỉ, toạ độ, loại, giờ mở cửa, trực đêm, xử lý chấn thương, SĐT, người xác nhận, ngày xác thực; hoặc để `pending` |
| Lưu điểm y tế bị `invalid_date` | Ngày xác thực ở tương lai (quá hôm nay theo giờ Việt Nam + 1 ngày) hoặc trước năm 2000 | Sửa ngày; hạn 90 ngày xác thực lại tính từ ngày này nên không được nhập trước |
| Lưu điểm y tế `verified` bị `invalid_coordinates` (`outside_vietnam`) | Toạ độ ngoài khung vĩ độ 8,1–23,5, kinh độ 102,1–109,6 (ví dụ nhập nhầm `0, 0` hoặc đảo lat/lng) | Sửa toạ độ; bản nháp `pending` vẫn lưu được mọi toạ độ hợp lệ |
| Bấm phát hành nhưng version không tăng, kết quả có `unchanged: true` | Nội dung gói giống hệt phiên bản hiện hành | Đúng thiết kế: thiết bị không bị báo có bản cập nhật giả. Cần phát hành lại thì gọi với `p_force = true` |
| App báo `recipient_phone_required` / `recipient_phone_invalid` / `recipient_phone_not_mobile` / `recipient_email_invalid` khi bật Buddy | Thiếu SĐT người nhận, SĐT sai dạng, số máy bàn Việt Nam 02x (không nhận được SMS), hoặc email đã nhập nhưng sai dạng | Nhập số di động `03x`/`05x`/`07x`/`08x`/`09x`, `+84…` hoặc `+<mã nước>…`; email có thể để trống |
| App báo `recipient_email_required` cho phiên chỉ có SĐT | Database chưa chạy `20260930000100_buddy_phone_required.sql` (vẫn dùng `op_buddy_start` của đợt 3) | Chạy migration đó rồi `notify pgrst, 'reload schema';` |
| Op `buddy.heartbeat` / `push.*` lỗi `unknown_op` | Database chưa chạy `20260930000200_trip_heartbeat_push.sql` | Chạy migration đó rồi `notify pgrst, 'reload schema';` |
| Phiên bị đánh dấu `contact_lost` dù người đi không gặp sự cố | Tín hiệu `paused` lúc ẩn / đóng app không tới được server (ví dụ tắt máy đột ngột), phiên vẫn `live` quá 15 phút | Người đi bấm check-in / *Tôi an toàn* (heartbeat tiếp theo không tự xoá cảnh báo); muốn chậm hơn thì tăng `contact_lost_after_min` |
| `push-dispatch` trả 401, hoặc không có thông báo đẩy | JWT verification còn bật, `CRON_SECRET` lệch, thiếu secret VAPID (`vapid_not_configured`), `vapidPublicKey` trong `config.js` trống hoặc khác `VAPID_PUBLIC_KEY`, người dùng chưa cho phép thông báo, hoặc iOS chưa cài PWA | Sửa cấu hình theo bước 7; xem `push_schedule.last_error` và `net._http_response` |
| Op `buddy.start` lỗi `rate_limited`, hoặc `register_device` lỗi `rate_limited` | Vượt giới hạn chống lạm dụng | Xem mục "Bảo mật: khoá anon và email cảnh báo"; nới giới hạn trong `app_private.settings` nếu cần cho buổi demo |
| Phiên `overdue` có sự kiện `alert_failed` với `reason = 'rate_limited'` và không có email | Người nhận đã nhận 3 email (cảnh báo hoặc "đã an toàn") trong 24 giờ, hoặc toàn hệ thống đã gửi 50 email trong 1 giờ; xoá thiết bị không đặt lại bộ đếm | Admin xem phiên trên dashboard và bấm "Gửi cảnh báo ngay" (thao tác thủ công không bị giới hạn), hoặc liên hệ người nhận trực tiếp |

## Quyền riêng tư

- Hồ sơ y tế đầy đủ không bao giờ lên server. Khi người dùng đồng ý, phiên Buddy chỉ lưu lớp công khai (nhóm máu, dị ứng, bệnh nền, thuốc, ghi chú); server lọc bỏ mọi trường khác trong `public_medical`.
- Thiết bị ẩn danh: không có tài khoản, chỉ `device_id` + secret.
- `audit_log` ghi thay đổi trạng thái phiên Buddy nhưng không chép email, số điện thoại hay vị trí.
- Người dùng rút lại đồng ý xử lý dữ liệu y tế (hoặc tắt chia sẻ trong cảnh báo) thì app gửi `buddy.update` với `share_public_medical = false` và server xoá `public_medical` của phiên đang mở ngay; email cảnh báo sau đó không còn thông tin y tế.
- "Xoá toàn bộ dữ liệu cá nhân" trên app gửi `device.erase` (xem mục "Data API"). Khi đang offline, app giữ lại một "bia mộ" chỉ gồm `device_id`, secret và các op `buddy.stop` + `device.erase`, rồi gửi lên khi có mạng.
- Heartbeat chỉ có trong phiên Buddy, khi app đang hiện trên màn hình: mỗi 5 phút một vị trí (vị trí cũ hơn 10 phút hoặc vị trí mô phỏng ngoài `?demo=1` không được gửi). Server chỉ giữ vị trí cuối trong `buddy_sessions`, không lưu chuỗi heartbeat.
- `push_subscriptions` / `push_schedule` không có toạ độ, tên hay số điện thoại; anon không đọc được, admin chỉ đọc. Cả hai bị xoá theo thiết bị (`device.erase`).

Thời hạn lưu trên server (trigger `buddy_sessions_defaults` và job hằng ngày `nc_cleanup()`):

| Dữ liệu | Khi nào bị xoá |
|---|---|
| `public_medical` của phiên Buddy | Ngay khi phiên đóng (`buddy.stop`, admin đóng sự cố, `device.erase`), hoặc khi tắt chia sẻ |
| Phiên Buddy đã đóng, kèm mọi `checkin_events` (vị trí, ghi chú), tên, email, SĐT người nhận | 30 ngày sau `closed_at` |
| Phiên Buddy còn mở nhưng không thay đổi gì | 90 ngày sau lần cập nhật cuối |
| `device_ops` (khoá idempotency của outbox) | 30 ngày |
| `devices.reg_ip_hash` (sha256 có muối của IP lúc đăng ký, chỉ dùng cho giới hạn đăng ký) | 24 giờ |
| `app_private.alert_ledger` (mỗi email cảnh báo / "đã an toàn": sha256 có muối của địa chỉ đã chuẩn hoá, loại, trạng thái, thời điểm; không có email, không có mã phiên hay thiết bị sau khi gửi xong) | 48 giờ, kể cả khi thiết bị đã gửi `device.erase` |
| `push_schedule` (lời nhắc Web Push) | Đã gửi quá 2 ngày, hoặc chưa gửi mà trễ quá 1 giờ (xoá mỗi lần `nc_push_claim()` chạy); lịch mới của thiết bị thay lịch cũ |
| `push_subscriptions` | Khi dịch vụ push trả 404 / 410, khi app gửi `push.unsubscribe`, hoặc `device.erase` |

`nc_cleanup()` trả số bản ghi đã xoá, ví dụ `{"sessions_deleted": 2, "events_deleted": 9, "device_ops_deleted": 40, "ip_hashes_cleared": 3, "ledger_deleted": 12}`. Bản ghi `devices` không có phiên nào vẫn được giữ (không chứa dữ liệu cá nhân) để điện thoại tiếp tục đồng bộ.

## Bảo mật: khoá anon và email cảnh báo

Khoá anon nằm trong `config.js` nên ai cũng lấy được. Với nó, một người lạ gọi được `register_device` rồi `sync_device_ops` để bật phiên Buddy tới một địa chỉ email bất kỳ, đặt chu kỳ 1 phút, và server sẽ gửi email cảnh báo từ địa chỉ gửi của project. Không chặn lại thì dead-man switch thành một dịch vụ chuyển tiếp email ẩn danh. Migration `20260928000100_hardening.sql` giới hạn việc này như sau, và `20260929000100_quota_ledger.sql` chuyển việc đếm sang một sổ ghi riêng mà `device.erase` không xoá được:

| Giới hạn | Mặc định | Khoá trong `app_private.settings` | Vượt thì |
|---|---|---|---|
| Phiên Buddy mới **có email thật** của một thiết bị trong 24 giờ (từ 20260930000100: phiên chỉ có SĐT hoặc email tên miền minh hoạ không bị đếm, không bị chặn, vì không làm server gửi được gì) | 5 | `limit_buddy_start_device_24h` | `buddy.start` lỗi `rate_limited` với `retryable: false`: app bỏ op đó và báo lỗi đồng bộ, phiên chỉ còn cảnh báo trên máy. Không thử lại vì một lần bắt đầu gửi muộn sẽ mang giờ bắt đầu cũ, tức là quá hạn ngay khi tới server |
| Email tới một người nhận trong 24 giờ (cảnh báo quá hạn / SOS / admin gửi tay, và email "đã an toàn"; bí danh Gmail tính chung) | 3 | `limit_alert_recipient_24h` | Phiên vẫn `overdue`, thêm một sự kiện `alert_failed {reason: 'rate_limited'}` hiện trên dashboard |
| Email toàn hệ thống trong 1 giờ (cùng cách đếm) | 50 | `limit_alert_global_1h` | Như trên, `limit = 'global_1h'` |
| `register_device` từ một IP trong 1 giờ | 30 | `limit_register_ip_1h` | `register_device` lỗi `rate_limited` |

Hai giới hạn email đếm trên `app_private.alert_ledger`, không đếm trên các phiên Buddy. Trước đợt 3d, kẻ gian chỉ cần gửi `device.erase` sau mỗi email là xoá luôn phiên và sự kiện đã gửi, bộ đếm về 0, nên cùng một người nhận có thể bị gửi không giới hạn. Sổ ghi hoạt động như sau:

- Mỗi email cảnh báo (quá hạn, SOS, admin gửi tay) được ghi ngay lúc `nc_alert_claim` nhận phiên, trước khi Edge Function gửi đi. Nhờ vậy email đang trên đường cũng được tính. `nc_alert_result` đổi dòng đó thành `sent`, `failed` (không tính vào giới hạn) hoặc `demo`.
- Email "đã an toàn" cũng được ghi và tính vào cả hai giới hạn, kể cả email gửi kèm khi `device.erase`. Email này không bao giờ bị chặn, vì người đã nhận cảnh báo phải được biết người đi đã an toàn, và mỗi email cảnh báo chỉ kéo theo tối đa một email "đã an toàn". Ví dụ với giới hạn mặc định 3: cảnh báo, "đã an toàn", cảnh báo, "đã an toàn", rồi cảnh báo thứ ba bị giữ lại với `rate_limited`.
- Địa chỉ được chuẩn hoá trước khi băm: chữ thường, bỏ phần `+tag`, và với Gmail thì bỏ dấu chấm và coi `googlemail.com` là `gmail.com`. `ban+1@gmail.com`, `b.a.n@googlemail.com` và `BAN@gmail.com` là cùng một người nhận.
- Sổ ghi chỉ lưu sha256 có muối (`ledger_salt` trong `app_private.settings`) của địa chỉ đã chuẩn hoá, không lưu email. Nó không có khoá ngoại tới phiên hay thiết bị. `device.erase` và việc xoá phiên sau 30 ngày không đụng tới nó; `nc_cleanup()` xoá dòng cũ hơn 48 giờ.
- Các lần nhận phiên được xếp hàng bằng advisory lock, nên lượt cron và một SOS gửi cùng lúc không cùng vượt qua một giới hạn.

Người nhận thuộc tên miền dành riêng (`example.com`, `*.test`…) không bao giờ nhận email thật nên không được ghi và không bị tính. Thao tác "Gửi cảnh báo ngay" của admin không bị chặn, vì admin đã đăng nhập và nhật ký ghi tên người bấm, nhưng email đó vẫn được ghi vào sổ. Giới hạn IP chỉ có hiệu lực khi request đi qua Data API (PostgREST gửi header `cf-connecting-ip` / `x-forwarded-for`); gọi từ SQL Editor thì không tính.

Nới giới hạn cho buổi demo, ví dụ khi giám khảo thử nhiều lần với cùng một email:

```sql
insert into app_private.settings (key, value) values ('limit_alert_recipient_24h', '10')
on conflict (key) do update set value = excluded.value;
```

Tên người đi xuất hiện trong tiêu đề email, nên server lọc URL và tên miền khỏi tên (mục "Data API"); Edge Function còn escape HTML toàn bộ dữ liệu. Những điểm còn hở, nhóm cần biết trước khi mở rộng:

- Người nhận chưa phải xác nhận (double opt-in) trước khi nhận email cảnh báo. Đây là rủi ro lớn nhất còn lại: kẻ gian vẫn gửi được tới mỗi địa chỉ lạ tối đa 3 email trong 24 giờ, với tên người đi do chúng tự đặt (đã lọc URL và tên miền), và tổng cộng tối đa 50 email mỗi giờ cho cả hệ thống. Tên người đi vẫn có thể chứa câu chữ kiểu lừa đảo, số điện thoại hoặc tên miền viết lách (`evil[.]org`, chữ full-width), vì bộ lọc tên chỉ bỏ URL, email và tên miền có đuôi phổ biến.
- Phiên bắt đầu lùi giờ (tối đa 24 giờ) có thể quá hạn ngay ở lượt cron đầu tiên. Server không bắt chờ thêm một chu kỳ, vì SOS và quá hạn phát hiện trên máy lúc mất sóng vẫn phải gửi cảnh báo ngay khi op tới server; kẻ gian luôn gửi được hai op đó. Giới hạn theo sổ ghi mới là lớp chặn thật.
- Chu kỳ check-in tối thiểu vẫn là 1 phút để demo nhanh được với email thật. Muốn chặt hơn, tăng `interval_min` tối thiểu trong `app_private.op_buddy_start`.
- Giới hạn theo IP không chặn được người đổi IP liên tục; khi đó giới hạn toàn hệ thống 50 email / giờ là trần.
- Web Push không mở thêm đường gửi thư rác: endpoint chỉ được thuộc dịch vụ push của trình duyệt (kiểm ở SQL, máy chủ mô phỏng và trong `push-dispatch`), nội dung đẩy cố định, không chứa chữ do người dùng nhập.
- `RESEND_API_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY` và khoá `service_role` chỉ nằm trong Secrets của Edge Function và `app_private.settings`, không nằm trong frontend. Payload "đã an toàn" gửi kèm trong body (dùng khi `device.erase` xoá phiên) chỉ được chấp nhận từ lời gọi có `x-nc-cron-secret`, không nhận từ JWT admin.

Lộ trình đề xuất để đóng lỗ hổng chuyển tiếp email, theo thứ tự:

1. Email xác nhận trước lần cảnh báo đầu tiên (double opt-in). Khi `buddy.start` dùng một địa chỉ server chưa từng thấy (so theo `recipient_hash`), server chỉ gửi một email ngắn có nội dung cố định, không chứa chữ do người đi nhập: "Có người muốn chọn bạn làm người nhận cảnh báo an toàn NomadCare. Bấm để đồng ý." Người nhận bấm link thì bảng `recipient_consents (recipient_hash, confirmed_at)` ghi nhận; chỉ địa chỉ đã xác nhận mới nhận email cảnh báo có tên người đi, vị trí và lớp y tế. Phiên tới người nhận chưa xác nhận mà quá hạn thì người nhận chỉ nhận một email trung tính (không có chữ do người dùng nhập), còn app nhắc người đi gọi điện / nhắn SMS dự phòng. Email nào cũng có link "không gửi cho tôi nữa", ghi `recipient_hash` vào danh sách chặn.
2. Giới hạn chính email xác nhận: tối đa 1 email / địa chỉ / 7 ngày, ghi vào sổ như mọi email khác.
3. Khi đã có opt-in: tên người đi chỉ nhận chữ cái, khoảng trắng và dấu câu cơ bản (bỏ dãy số dài, chuẩn hoá NFKC trước khi lọc tên miền), và chu kỳ check-in tối thiểu 15 phút ngoài chế độ demo.

## Kiểm thử cục bộ (không cần Supabase)

`tools/db-test/run.sh` dựng một PostgreSQL + PostGIS tạm, giả lập phần Supabase cung cấp (`supabase_shim.sql`: role anon/authenticated/service_role, schema auth, pg_net và pg_cron giả), rồi chạy migrations hai lần, seed (hai lần, để kiểm tra seed chạy lại được) và các phép kiểm trong `tests.sql` trên hai database: `nc_test` có realtime/pg_net/pg_cron và chạy từng migration (719 phép kiểm), `nc_test_bare` không có và chạy `setup_all.sql` (706 phép kiểm). Lần chạy gần nhất (02/10/2026, PostgreSQL 18 + PostGIS 3.6) đạt hết.

Khi có `node`, script còn chạy `tools/db-test/expected_packs.js`: nạp `seed-core.js` + `backend-local.js` như trình duyệt, dựng gói dữ liệu cho từng tuyến × nhà mạng, và `tests.sql` so gói đó với `get_data_pack()` / `build_data_pack()` (khoá, node, cạnh, đoạn sóng, cơ sở y tế đã xác minh, dịch vụ), với `list_routes()` và với `admin_kpis()`. Lệch nhau nghĩa là `seed.sql` và `seed-core.js` không cùng một lần build, hoặc hai bộ dựng gói (SQL và JS) đã khác nhau. Tắt bằng `--no-parity`; `node tools/db-test/expected_packs.js --summary` in bảng số lượng mong đợi. Các phần "e2e" chạy trọn luồng thiết bị (đăng ký → bắt đầu Buddy → check-in → gửi lại op trùng → quá hạn → `nc_mark_overdue` → `admin_resolve_session`) và luồng quản trị (báo cáo cộng đồng → duyệt → xác minh → `admin_publish_pack`).

```bash
tools/db-test/run.sh --cluster /tmp/nc-pg --pg-bin /duong-dan/postgres/bin --quiet
```

Script cũng sinh lại `supabase/setup_all.sql`, nên chạy nó sau mỗi lần sửa migration.

Edge Function kiểm thử được mà không cần Deno: `tools/db-test/edge/run.sh [thư-mục-ra]` chạy `tsc --strict` với stub kiểu cho cả hai function, rồi chạy chúng trên Node 18+ với Deno, supabase-js, Resend và web-push giả. Với `deadman-alert`: mã HTTP, CORS, escape HTML, khoá idempotency, tên miền demo, tiêu đề email SOS và `contact_lost`, tên admin được chuyển vào RPC khi gửi thủ công, báo lỗi khi Resend từ chối; email được xuất ra `email-*.html` (quá hạn, SOS, mất liên lạc, đã an toàn) và `email-overdue.txt` (bản văn bản thuần) để xem. Với `push-dispatch`: 405/401 khi sai phương thức hoặc secret, khoá VAPID lấy từ secrets, chỉ POST tới dịch vụ push của trình duyệt, nội dung theo ngôn ngữ đăng ký và không có toạ độ, TTL bằng số phút trước vùng mất sóng, endpoint 404/410 bị xoá, lỗi 500 được ghi để thử lại.

Phần 10 của `tests.sql` kiểm các thay đổi của đợt 3, `20260930000100` và `20261002000100`: SĐT người nhận bắt buộc (bảng 35 trường hợp của `norm_phone`, giống `data.test.js`), chỉ nhận số di động (bảng 24 trường hợp của `valid_phone` / `phone_is_landline`, giống `PHONE_KIND_CASES` của `data.test.js`; phiên mới với số 02x lỗi `recipient_phone_not_mobile`, phiên cũ đã lưu số máy bàn vẫn chạy), email không bắt buộc, phiên chỉ có SĐT không bị giới hạn khởi tạo và không bao giờ được gửi email, phiên cũ chỉ có email vẫn chạy, lọc tên, các giới hạn chống lạm dụng, `alert_reason` khi SOS, `buddy.update`, `device.erase` (cả khi gửi lại), thời hạn lưu, tên admin trong nhật ký, duyệt lại đóng góp không tạo trùng điểm y tế, ngày xác thực ở tương lai, khung toạ độ Việt Nam, nhật ký duyệt mẫu sóng, `admin_pack_changes` và phát hành không đổi. `tools/tests/data.test.js` kiểm cùng các hành vi đó trên máy chủ mô phỏng `backend-local.js`.

Phần 10b kiểm sổ ghi email cảnh báo: vòng lặp bắt đầu phiên → quá hạn → email → `device.erase` sáu lần tới cùng một người nhận (và các bí danh Gmail) chỉ gửi được trong giới hạn, email "đã an toàn" được tính, email đang gửi dở vẫn được tính sau khi xoá thiết bị, gửi lỗi không bị tính, giới hạn toàn hệ thống không bị xoá, sổ ghi không chứa địa chỉ email, `nc_cleanup()` xoá dòng cũ hơn 48 giờ, anon / authenticated không đọc được sổ. `region_en` được kiểm cùng hình dạng và độ khớp của `list_routes()` / gói dữ liệu (phần 1, 2, 2b).

Phần 10c kiểm `20260930000200`: `buddy.heartbeat`, phát hiện `contact_lost` (phiên `paused`, `silence_until` hoặc check-in gần đây thì không báo; phiên chỉ có SĐT không bao giờ được gửi email), op `push.subscribe` / `unsubscribe` / `schedule`, API của `push-dispatch` (`nc_push_claim` / `nc_push_result` / `nc_push_tick`) và phân quyền.
