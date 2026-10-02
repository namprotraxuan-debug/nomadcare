# NomadCare v2 — Chiếc phao sinh tồn kỹ thuật số cho phượt thủ tại Việt Nam

Đội **Stormbreakers** · AISC'26 · chủ đề *Digital Business Ideas*.
Ứng dụng web (PWA, cài được lên điện thoại) hỗ trợ an toàn y tế cho khách du lịch bụi, vận hành theo triết lý **offline-first**: mọi tính năng cứu mạng chạy được khi mất sóng hoàn toàn. Kèm dashboard quản trị và backend Supabase (PostgreSQL + PostGIS).

> Toàn bộ điểm y tế, số điện thoại (`+84 000 000 0NN`), lớp phủ sóng và phiên Buddy trong bản này là **dữ liệu minh hoạ**. Nội dung y tế (câu dịch MOD.01, sơ cứu MOD.05) đang ở trạng thái `in_review` — **chưa được cố vấn y tế ký duyệt**, chưa dùng cho người thật (mục 8.1 thuyết minh).

## 1. Chạy nhanh

```bash
python3 -m http.server 8099
```

Mở `http://localhost:8099/index.html?demo=1` (app người dùng) và `http://localhost:8099/admin.html` (dashboard → bấm **Vào chế độ demo**).
Không có Python: mở thẳng `index.html` bằng trình duyệt (file://) — app vẫn chạy, chỉ thiếu service worker và định vị.

Định vị, service worker và thông báo cần **HTTPS** hoặc `localhost`. Khi chưa cấp quyền vị trí, mỗi lần mở app hiện thẻ "Cho phép dùng vị trí?" ([Để sau] [Cho phép]); hộp xin quyền của trình duyệt chỉ mở khi bấm *Cho phép*. Đã từ chối thì chọn điểm xuất phát thủ công ở ô "Từ" trên Bản đồ.

| Tham số URL | Tác dụng |
|---|---|
| `?demo=1` | Bỏ qua onboarding, nạp hồ sơ demo. Nếu GPS thật cách mọi tuyến thí điểm > 30 km thì giữ vị trí mô phỏng ở Quản Bạ (toast có nút *Dùng vị trí thật*) |
| `?reset=1` | Xoá toàn bộ dữ liệu trên máy, bắt đầu lại từ onboarding |
| `?offline=1` · `?offline=0` | Bật / tắt giả lập mất sóng (hoặc bấm nút trạng thái mạng → "Giả lập mất sóng") |
| `?theme=dark` · `?lang=en` | Giao diện tối · tiếng Anh |
| `#/map`, `#/buddy`… hoặc `?screen=map` | Mở thẳng một màn hình |
| `?backend=local` | Ép dùng máy chủ mô phỏng dù đã cấu hình Supabase (cả `admin.html`) |
| `?nosw=1` | Gỡ service worker của trang (dùng khi kiểm thử) |
| `admin.html?debug=1` | Lộ đối tượng bản đồ nhiệt cho script kiểm thử |

Trong app, công cụ trình diễn (mô phỏng hành trình MOD.04, công thức cảnh báo, vị trí mô phỏng MOD.02) nằm trong mục **Chế độ demo** — luôn có nhưng gập sẵn, một chạm là mở.

## 2. Năm module (khớp Bảng 4 thuyết minh)

| Mã | Màn hình | Điểm chính |
|---|---|---|
| MOD.01 | Dịch y tế 1 chạm (`#/translate`) | Bước 1 chỉ còn hình cơ thể bấm được (đầu, ngực, bụng, tay, chân; nhãn ngôn ngữ khách + tiếng Việt hiện khi rê chuột, focus hoặc giữ ngón tay) và nút *Da & toàn thân* → triệu chứng → mức Nhẹ/Vừa/Nặng → màn hình song ngữ chữ lớn; 7 ngôn ngữ (vi, en, zh, ko, ja, ru, fr); 4 chạm từ trang chủ; mã câu, phiên bản nội dung, trạng thái duyệt gập trong *Xem thêm*; câu nhanh + câu hỏi của nhân viên y tế; đọc to |
| MOD.02 | Bản đồ & định tuyến (`#/map`) | Định tuyến kết hợp: trong 3 hành lang thí điểm chạy A* offline hai chiến lược (ngắn nhất / ưu tiên có sóng); có mạng thì tìm mọi địa điểm ở Việt Nam (Nominatim, chỉ khi nhấn Enter hoặc dòng "Tìm …") và dẫn đường OSRM sau khi người dùng đồng ý một lần. Tuyến tô 4 mức: có sóng / không chắc / mất sóng / xám *Chưa có dữ liệu sóng*. Nút *Bắt đầu đi* bật nhắc trước vùng mất sóng, *Gửi vị trí* mở cửa sổ gửi toạ độ. Cơ sở y tế đã xác thực gần nhất (chỉ xếp theo khoảng cách), điểm dừng, gói dữ liệu tuyến và **nền bản đồ offline** dạng vector tải theo yêu cầu |
| MOD.03 | Hồ sơ QR sinh tồn (`#/qr`) | Lớp công khai (nhóm máu, dị ứng, bệnh nền, thuốc) trong QR đọc được bằng camera bất kỳ; hình nền màn hình khoá; thẻ ví in được; chế độ người cứu hộ, lớp định danh chỉ hiện sau thao tác giữ/mã ngắn; mã hoá AES-GCM trên máy |
| MOD.04 | Buddy Check-in (`#/buddy`) | Dead-man switch: **số di động người nhận bắt buộc** (Việt Nam 03x/05x/07x/08x/09x hoặc số quốc tế; số máy bàn 02x bị từ chối vì không nhận được SMS), email không bắt buộc. Có email thì máy chủ tự email khi quá hạn, SOS hoặc mất liên lạc bất thường; chỉ có SĐT thì máy chủ không tự báo, app nói rõ và đưa nút *Gửi SMS*. Nhắc trước vùng mất sóng theo chuyến đi (ngưỡng xe máy 5 phút/2 km, đi bộ 15 phút/0,8 km); tín hiệu định kỳ 5 phút khi app mở; hàng đợi gửi khi có sóng; **mô phỏng hành trình** trong *Chế độ demo* |
| MOD.05 | Sơ cứu offline (`#/firstaid`) | 31 tình huống (gồm cả hen suyễn, ngộ độc/rượu giả/nấm, chảy máu cam, điện giật/sét, chấn thương mắt, sứa đốt, sốt), từng bước có minh hoạ SVG, dấu hiệu phải gọi 115, điều không được làm, cảnh báo mẹo dân gian nguy hiểm, nguồn tham chiếu; đếm nhịp ép tim 110 lần/phút; túi sơ cứu |

Thêm: onboarding 5 bước (chọn nhà mạng, chấp thuận riêng dữ liệu y tế nhạy cảm theo NĐ 356/2025, hồ sơ 4 trường bắt buộc), cài đặt (giao diện sáng/tối/tự động, nhà mạng, mục *Kết nối & kỹ thuật* với trạng thái máy chủ, gói dữ liệu, hàng đợi; xem/xoá toàn bộ dữ liệu một chạm; bật/tắt tìm đường trực tuyến; đo thời gian MOD.01 cho thử nghiệm thực địa), nút **Khẩn cấp** (115 · SOS · 113/114/112) ở mọi màn hình. Thanh trên cùng chỉ còn trạng thái mạng và VI/EN. Điều hướng thu gọn được: PC (≥ 1200 px) bấm nút để thu sidebar thành dải biểu tượng 88 px và nhớ theo thiết bị; tablet có dải biểu tượng, nút ☰ mở sidebar dạng ngăn kéo; điện thoại có thanh tab tự ẩn khi cuộn xuống, hiện lại khi cuộn lên — nút đỏ 115 luôn hiện. Biểu tượng tab, màn hình chính và thông báo dùng chung một logo (`assets/img/logo.svg`).

Dashboard (`admin.html`): tổng quan KPI (x/216 điểm y tế đã xác thực), quản lý điểm y tế (bắt buộc đủ trường mới được "đã xác thực", tái xác thực 90 ngày), duyệt đóng góp cộng đồng, bản đồ nhiệt vùng lõm sóng, giám sát Buddy (quá hạn nổi đỏ; SOS và *Mất liên lạc bất thường* có nhãn riêng kèm giờ tín hiệu cuối; gửi cảnh báo), phát hành gói dữ liệu & nội dung y tế, nhật ký.

## 3. Kết nối dữ liệu (kiến trúc 2 tầng — Hình 1 thuyết minh)

```
THIẾT BỊ (PWA, chạy offline)                         MÁY CHỦ (Supabase)
 IndexedDB: gói dữ liệu tuyến, outbox,        ⇄ khi có sóng   PostgreSQL + PostGIS: tuyến, lớp sóng,
 hồ sơ y tế MÃ HOÁ (không bao giờ gửi lên)                     điểm y tế, phiên Buddy, nhật ký
 Service worker: cache toàn bộ app                           RPC: get_data_pack, sync_device_ops…
 Cache 'nc-basemap-v1': nền bản đồ offline                   pg_cron mỗi phút → deadman-alert → email Resend
                                                             pg_cron mỗi phút → push-dispatch → Web Push (tuỳ chọn)
```

- **Chế độ cục bộ (mặc định):** để trống khoá trong `assets/js/config.js` → app dùng máy chủ mô phỏng ngay trong trình duyệt (IndexedDB, cron mỗi 15 giây). App và dashboard mở cùng địa chỉ dùng chung dữ liệu và cập nhật trực tiếp qua BroadcastChannel — đủ để demo trọn luồng mà không cần Internet. Ở chế độ này **mọi email đều là mô phỏng**: không email nào được gửi đi, app và dashboard ghi rõ "mô phỏng"; lời nhắc trước vùng mất sóng chỉ là hẹn giờ trong app.
- **Chế độ Supabase:** làm theo [`supabase/README.md`](supabase/README.md) (tạo project miễn phí, chạy `setup_all.sql` + `seed.sql`, tạo tài khoản admin, triển khai Edge Function `deadman-alert`, tuỳ chọn `push-dispatch`), rồi điền `supabaseUrl` + `supabaseAnonKey` (và `vapidPublicKey` nếu dùng Web Push) vào `assets/js/config.js`.
- Ghi từ thiết bị lên máy chủ luôn đi qua **outbox**: mất sóng thì xếp hàng, có sóng lại thì tự gửi (idempotent theo mã thao tác). Chỉ tab app gửi outbox; dashboard không bao giờ gửi thay thiết bị.
- Quyền riêng tư: hồ sơ y tế mã hoá AES-GCM trên máy; lớp y tế công khai chỉ đi kèm cảnh báo Buddy khi người dùng đồng ý riêng và có email người nhận, và bị xoá khỏi máy chủ khi rút đồng ý hoặc dừng phiên. Vị trí chỉ rời máy khi: bật Buddy (check-in, SOS, tín hiệu định kỳ), người dùng tự gửi toạ độ, gửi báo cáo cộng đồng, hoặc dùng tìm đường trực tuyến. *Xoá toàn bộ dữ liệu* cũng gửi lệnh xoá sang máy chủ (nếu đang offline thì xếp hàng, gửi khi có sóng). Phiên đã đóng quá 30 ngày bị máy chủ xoá.
- Chống lạm dụng gửi email: mặc định tối đa 5 phiên Buddy **có email thật**/thiết bị/24 giờ (phiên chỉ có SĐT hoặc dùng tên miền minh hoạ không bị tính), 3 email/người nhận/24 giờ, 50 email/giờ toàn hệ thống. Giới hạn email tính cả email "đã an toàn", gộp bí danh Gmail và được đếm trong một sổ ghi riêng (chỉ lưu hash email, xoá sau 48 giờ) nên *Xoá toàn bộ dữ liệu* / `device.erase` không đặt lại được. Có thể ghi đè bằng các khoá `limit_buddy_start_device_24h`, `limit_alert_recipient_24h`, `limit_alert_global_1h` trong bảng `app_private.settings` (ví dụ khi giám khảo cần thử nhiều lần với cùng một email). Email tới tên miền dành riêng như `example.com` không bao giờ được gửi thật.

**Bản đồ nền và dịch vụ OpenStreetMap**
- Ảnh nền raster: CARTO cần API key (miễn phí tại carto.com, thêm `?key=` vào URL trong `config.js`); chưa có key thì dùng tile chuẩn `tile.openstreetmap.org`. Tile OSM chỉ dùng để **xem trực tuyến bình thường**: luôn gửi Referer (`referrerPolicy: 'strict-origin-when-cross-origin'` trên lớp tile và thẻ `<meta name="referrer">`), không tải trước, không tải hàng loạt, không dựng gói offline từ tile OSM. Service worker chỉ giữ tile đã xem theo header HTTP (tối đa 600 ô), không bao giờ lưu ô "Access blocked" / "API key required"; khi ô bị chặn hoặc lỗi, bản đồ hiện thông báo và dùng nền offline nếu đã tải cho vùng đang xem. Dòng ghi nguồn "© OpenStreetMap contributors" luôn hiện.
- **Nền bản đồ offline** (đường, sông suối, hồ, địa danh, đỉnh núi) cho từng hành lang: trích một lần từ OSM qua Overpass lúc dựng dữ liệu (`tools/seed/build_basemap.py`, giấy phép ODbL), mỗi tuyến một file JSON 137–673 KB (giới hạn 700 KB/tuyến) trong `assets/data/basemap/`. Dữ liệu Overpass thô (`tools/seed/cache/overpass-*.json`) không nộp kèm và nằm trong `.gitignore`; app chỉ cần các file JSON đã sinh. File **không** nằm trong precache; người dùng tải ở thẻ *Gói dữ liệu* của Bản đồ (hoặc qua gợi ý khi lộ trình đi qua vùng mất sóng, *Để sau* được nhớ theo tuyến), app lưu vào Cache Storage `nc-basemap-v1`. Nền vector tự hiện khi không có ảnh nền (offline, bị chặn, lỗi) và bật/tắt được trong menu *Lớp bản đồ*.
- **Tìm đường trực tuyến** ngoài 3 tuyến thí điểm: lần đầu app hỏi đồng ý một dòng ("gửi vị trí và điểm đến tới dịch vụ OpenStreetMap"), lựa chọn được nhớ và tắt được trong Cài đặt → Quyền riêng tư. Tìm kiếm chỉ gửi chữ đã gõ tới Nominatim (`countrycodes=vn`), **chỉ khi nhấn Enter hoặc chọn dòng "Tìm …"** — chính sách Nominatim cấm tự hoàn thành theo từng phím; dẫn đường gửi toạ độ điểm đi và điểm đến tới OSRM của FOSSGIS (xe máy dùng hồ sơ ô tô vì OSRM không có hồ sơ xe máy; đi bộ dùng hồ sơ foot). Tối đa 1 yêu cầu/1,1 giây, có cache. Đoạn đường không có dữ liệu sóng tô xám. Offline và cách hành lang > 30 km thì app báo cần mạng.

**Nhắc trước vùng mất sóng (không theo dõi GPS liên tục)**
- Bấm *Bắt đầu đi* trên kết quả lộ trình MOD.02 (hoặc bật Buddy khi đã có lộ trình cùng tuyến trong 24 giờ): app tính giờ tới đầu mỗi vùng mất sóng theo tốc độ định tuyến (xe máy 25 km/h, đi bộ 3,5 km/h) và hẹn nhắc lúc **ETA − 5 phút** (xe máy) / **ETA − 15 phút** (đi bộ). Vùng gần nhau dưới 2 km / 0,8 km gộp thành một lần nhắc.
- Mỗi lần mở lại app, sau mỗi check-in và mỗi tín hiệu Buddy, app lấy **một** vị trí GPS (không hỏi quyền lại), chiếu lên lộ trình và tính lại. Chuyến đi tự kết thúc khi tới cách đích 300 m hoặc sau 2 lần thời gian dự kiến.
- Khi tới giờ: thông báo hệ thống (khi app ẩn) và cửa sổ trong app — giữ nguyên khi chuyển màn hình — "Sắp vào vùng mất sóng ~N phút (dài X km). Gửi toạ độ cho người thân?": [Gửi SMS] mở ứng dụng SMS với toạ độ, link OpenStreetMap, giờ và thời gian dự kiến mất sóng; [Chia sẻ] (bảng chia sẻ của máy, không có thì chép vào bộ nhớ tạm); [Để sau]. Người nhận: SĐT của phiên Buddy, không có thì SĐT liên hệ khẩn cấp trong hồ sơ QR, không có nữa thì nút *Bật Buddy*. App chỉ báo "Đã mở ứng dụng SMS", không bao giờ "đã gửi".
- Không có Web Push (chế độ cục bộ, `vapidPublicKey` trống, iOS ngoài PWA đã cài), lời nhắc chỉ hiện khi app còn mở, kể cả chạy nền. Ở chế độ Supabase có `vapidPublicKey`, lịch nhắc được gửi lên máy chủ và Edge Function `push-dispatch` đẩy thông báo đúng giờ kể cả khi app đã đóng.

**Tín hiệu định kỳ (heartbeat) và mất liên lạc bất thường**
- Chỉ trong phiên Buddy: khi app hiện trên màn hình và có mạng, cứ 5 phút gửi `buddy.heartbeat` (trạng thái `live`, một vị trí, và `silence_until` = giờ dự kiến ra khỏi vùng mất sóng đang ở, hoặc vùng bắt đầu trong 20 phút tới, + 15 phút; ngoài ra để trống). Ẩn hoặc đóng app thì gửi lần cuối với trạng thái `paused`.
- Máy chủ: phiên `live` quá 15 phút không có tín hiệu lẫn check-in, ngoài `silence_until` → chuyển sang quá hạn với lý do `contact_lost`, hiện trên dashboard và email người nhận nếu phiên có email. Phiên `paused` chỉ còn dead-man switch thường.

**Trước buổi demo có kết nối Supabase:**
1. Project mới: chạy `supabase/setup_all.sql` (gộp đủ 14 migration, tới `20261002000100_buddy_mobile_only.sql`), rồi `notify pgrst, 'reload schema';`. Project cũ đã chạy tới `20260929000100_quota_ledger.sql`: chạy thêm **theo thứ tự** `supabase/migrations/20260930000100_buddy_phone_required.sql` (SĐT bắt buộc, email tuỳ chọn — thiếu file này thì phiên chỉ có SĐT bị máy chủ từ chối), `20260930000200_trip_heartbeat_push.sql` và `20261002000100_buddy_mobile_only.sql` (chỉ nhận số di động — thiếu file này thì máy chủ vẫn nhận số máy bàn 02x), rồi `notify pgrst, 'reload schema';`. Project cũ hơn: chạy các migration còn thiếu theo thứ tự tên, hoặc dán lại cả `setup_all.sql` (an toàn khi chạy lại). Không chạy lại riêng một file cũ như `0800_cron.sql`: các file sau đã thay hàm của nó (xem `supabase/README.md`). Muốn gói dữ liệu đã phát hành có `region_en` ngay thì chạy thêm `select app_private.publish_all_packs('Thêm region_en');`.
2. Triển khai lại Edge Function `supabase/functions/deadman-alert` (mẫu email `contact_lost`; secrets `RESEND_API_KEY`, `CRON_SECRET`, `ALERT_FROM`). Muốn có Web Push: triển khai `push-dispatch` (secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`; tắt JWT verification) và điền `vapidPublicKey` vào `config.js` — xem `supabase/README.md` bước 7.
3. Mở dashboard Supabase một lần để project không bị tạm dừng (gói Free dừng sau 7 ngày không dùng).
4. Muốn giám khảo nhận email cảnh báo thật: nhập email thật cho người nhận Buddy (email `@example.com` chỉ ghi nhận, không gửi; phiên chỉ có SĐT thì máy chủ không gửi gì).

### Email cảnh báo chứa gì?

Nguồn: mẫu email trong `supabase/functions/deadman-alert/index.ts` (hàm `buildEmail`), dữ liệu lấy từ `app_private.alert_payload`. Mỗi email gửi qua Resend có hai bản, HTML và văn bản thuần, song ngữ Việt – Anh. Bản văn bản thuần ngắn hơn bản HTML (xem *Bản văn bản thuần* ở cuối mục).

**Ai gửi, ai nhận**
- Người gửi: địa chỉ trong secret `ALERT_FROM` (mặc định `NomadCare <onboarding@resend.dev>`; địa chỉ mặc định này của Resend chỉ gửi được tới chủ tài khoản Resend, cần tên miền đã xác minh để gửi cho người khác). Nếu đặt `ALERT_REPLY_TO` thì người nhận trả lời về địa chỉ đó.
- Người nhận: duy nhất email người nhận của phiên Buddy, và chỉ khi người dùng đã nhập email. SĐT người nhận bắt buộc nhưng máy chủ không gửi SMS. Phiên chỉ có SĐT thì máy chủ không gửi email nào (kể cả `contact_lost`); app ghi rõ máy chủ không tự báo, và khi quá hạn hoặc SOS người đi tự bấm *Gửi SMS* trên máy.
- Không gửi thật: địa chỉ thuộc tên miền dành riêng (`example.com`, `*.test`, `*.invalid`, `localhost`…, được ghi là provider `demo`), khi đặt `ALERT_DRY_RUN=1`, và toàn bộ **chế độ cục bộ** (không có khoá Supabase): máy chủ mô phỏng trong trình duyệt chỉ ghi sự kiện `alert_sent` với provider `simulated`, app ghi rõ "Email mô phỏng — bản cục bộ không gửi email thật".

**Các loại email và tiêu đề** (`{tên}` = tên hiển thị của người đi đã làm sạch, tối đa 60 ký tự; thiếu tên thì "Người dùng NomadCare" ở phần tiếng Việt / "A NomadCare user" ở phần tiếng Anh)

| Loại | Khi nào gửi | Tiêu đề |
|---|---|---|
| Quá hạn (`overdue`) | Hết hạn check-in + ân hạn mà chưa check-in: cron mỗi phút, hoặc ngay khi máy báo quá hạn lúc có sóng | `[NomadCare] {tên} chưa check-in đúng hẹn · {tên} missed a scheduled check-in` |
| SOS (`sos`) | Người đi bấm SOS (gửi ngay; SOS sau một email quá hạn thì gửi lại, lần này ghi SOS) | `[NomadCare] SOS · {tên} vừa gửi tín hiệu cầu cứu · {tên} sent an SOS` |
| Mất liên lạc bất thường (`contact_lost`) | Ứng dụng đang mở (tín hiệu `live`) nhưng máy chủ không nhận được tín hiệu định kỳ (heartbeat, 5 phút/lần) lẫn check-in hơn 15 phút (khoá `contact_lost_after_min`), và không nằm trong vùng mất sóng dự kiến của lộ trình (`silence_until` trống hoặc đã qua). Ứng dụng ẩn / đóng (`paused`) thì chỉ còn dead-man switch thường. Cron mỗi phút; phiên không có email thì không gửi, chỉ hiện trên dashboard (nhãn *Mất liên lạc bất thường*, giờ tín hiệu cuối) | `[NomadCare] Mất liên lạc bất thường với {tên} · Lost contact with {tên}` |
| Cảnh báo thủ công (`manual`) | Quản trị viên bấm *Gửi cảnh báo ngay* khi phiên chưa quá hạn (phiên đã quá hạn thì email mang nội dung quá hạn / SOS / mất liên lạc tương ứng) | `[NomadCare] Cảnh báo an toàn về {tên} · Safety alert about {tên}` |
| Đã an toàn (all-clear, `resolved`) | Chỉ sau khi đã có email cảnh báo: người đi check-in / báo an toàn, dừng phiên, quản trị viên đánh dấu đã xử lý, hoặc xoá toàn bộ dữ liệu (`device.erase`) | `[NomadCare] {tên} đã an toàn · All clear: {tên} is safe` |

Mỗi đợt quá hạn chỉ gửi một email cảnh báo. Nếu Resend báo lỗi, máy chủ thử lại với độ trễ tăng dần (2, 4, 8… phút) và dừng sau 6 lần lỗi trong 1 giờ; lỗi hiện trên dashboard (`alert_failed`), không hiện trên máy người đi.

**Nội dung bản HTML**
1. Dải đầu email (đỏ khi cảnh báo, xanh khi "đã an toàn"): dòng "NomadCare · Buddy Check-in", tiêu đề tiếng Việt và tiếng Anh. Trong thân email, tiêu đề SOS bắt đầu bằng "SOS: ".
2. Lời chào "Chào {tên người nhận}," / "Hi {tên người nhận}," (chỉ khi có tên người nhận) và một đoạn giải thích theo loại, tiếng Việt rồi tiếng Anh:
   - Quá hạn: người đi đã quá hạn check-in, kèm thời gian kể từ lần check-in cuối.
   - SOS: người đi đã bấm SOS; bên dưới là vị trí và thông tin gần nhất hệ thống nhận được.
   - Mất liên lạc: ứng dụng đang mở và gửi tín hiệu định kỳ nhưng máy chủ không nhận được tín hiệu nào từ {giờ} ({bao lâu} trước), kèm câu "Đây là mất kết nối bất thường, không phải vùng mất sóng dự kiến trên lộ trình."
   - Thủ công: quản trị viên NomadCare gửi vì chưa liên lạc được với người đi.
   - Đã an toàn: người đi đã check-in lại hoặc đã được xác nhận an toàn, cảnh báo trước đó đã đóng.
3. Bảng thông tin (giờ Việt Nam, ghi "(GMT+7)"). Bốn mốc giờ có cả định dạng Việt lẫn Anh: lần check-in cuối, thời điểm bấm SOS, tín hiệu cuối và hạn check-in tiếp theo. Hạn check-in của email quá hạn / thủ công và thời điểm của vị trí cuối chỉ ghi định dạng Việt.
   - Lần check-in cuối (mọi loại).
   - Email SOS: thời điểm bấm SOS. Email mất liên lạc: tín hiệu cuối từ ứng dụng và hạn check-in tiếp theo. Email quá hạn / thủ công: hạn check-in, kèm "chu kỳ N phút, ân hạn M phút" và dòng tiếng Anh "every N min, grace M min".
   - Vị trí cuối: toạ độ (5 chữ số thập phân) và thời điểm ghi nhận vị trí đó; chưa có vị trí thì ghi "Chưa có vị trí · No location received".
   - Cung đường (tên tiếng Việt, kèm tên tiếng Anh nếu khác) và phương tiện (xe máy / đi bộ).
   - Email "đã an toàn": ghi chú khi xác nhận an toàn (nếu có).
4. Nút "Mở Google Maps · Open in Google Maps" và "OpenStreetMap" tại vị trí cuối (chỉ khi có toạ độ).
5. Khung "Hồ sơ y tế công khai · Public medical profile" (nhóm máu, dị ứng, bệnh nền, thuốc đang dùng, ghi chú; trường trống hoặc `unknown` bị bỏ) kèm dòng "Người dùng đã đồng ý chia sẻ phần này · shared with the user's consent". Chỉ có khi người đi đã bật *Gửi kèm lớp y tế công khai trong cảnh báo* (cần đồng ý riêng về dữ liệu y tế nhạy cảm và phải có email người nhận). Không bao giờ có trong email "đã an toàn".
6. "Bạn nên làm gì" / "What you should do": gọi hoặc nhắn tin cho người đi; nếu không liên lạc được thì gọi 112 (tìm kiếm cứu nạn) hoặc 115 (cấp cứu) và đọc vị trí cuối; báo công an (113) hoặc kiểm lâm gần vị trí cuối; không tự đi tìm một mình vào vùng mất sóng. Email "đã an toàn": mục "Tiếp theo" ghi không cần làm gì thêm.
7. Chân email: "Email tự động từ NomadCare vì {tên} đã chọn bạn làm người nhận cảnh báo. NomadCare không xác nhận được tình trạng thực tế của người dùng; thông tin trên là dữ liệu cuối cùng thiết bị gửi được." (kèm bản tiếng Anh) và dòng "Mã phiên · Session: {mã phiên}".

**Bản văn bản thuần** có cùng dòng đầu, tiêu đề, đoạn giải thích, các dòng của bảng dạng `Nhãn Việt / Nhãn Anh: giá trị` (giờ chỉ theo định dạng Việt, cung đường chỉ tên tiếng Việt, hạn check-in ghi `(chu kỳ/ân hạn min)`, chưa có vị trí thì ghi `Chưa có vị trí / No location`), hai link Google Maps / OpenStreetMap dạng URL, các dòng hồ sơ y tế công khai (cùng điều kiện như trên) và hướng dẫn tiếng Việt rồi tiếng Anh. Khác bản HTML: lời chào chỉ có tiếng Việt, **không có** dòng "Người dùng đã đồng ý chia sẻ phần này", **không có** đoạn chân email giải thích; dòng cuối chỉ là `Session: {mã phiên}`.

**Không bao giờ có trong email:** họ tên thật, quốc tịch, giấy tờ và liên hệ khẩn cấp của lớp định danh trong hồ sơ QR; hồ sơ y tế mã hoá ngoài lớp công khai đã đồng ý; số điện thoại của người đi hay của người nhận; nhật ký sự kiện, lộ trình chi tiết, mã thiết bị, địa chỉ IP.

**Giới hạn chống lạm dụng**
- Tối đa 5 phiên Buddy mới có email thật trên một thiết bị trong 24 giờ. Phiên chỉ có số điện thoại hoặc dùng tên miền minh hoạ không bị tính.
- Tối đa 3 email cho một người nhận trong 24 giờ, tính cả email "đã an toàn". Email "đã an toàn" được đếm nhưng không bao giờ bị chặn.
- Tối đa 50 email mỗi giờ cho toàn hệ thống.
- Hạn mức được đếm trong sổ `app_private.alert_ledger`: chỉ lưu hash có muối của email đã chuẩn hoá (gộp bí danh Gmail), xoá sau 48 giờ. *Xoá toàn bộ dữ liệu* không đặt lại được hạn mức.
- Email bị chặn vì hạn mức thì không được gửi. Dashboard hiện sự kiện `alert_failed` với lý do `rate_limited`; app của người đi không biết điều này, nên nút *Gửi SMS* luôn có sẵn.
- Cảnh báo thủ công của quản trị viên không bị chặn nhưng vẫn được đếm.
- Đổi giới hạn bằng các khoá `limit_buddy_start_device_24h`, `limit_alert_recipient_24h`, `limit_alert_global_1h` trong `app_private.settings`.

**Thông báo đẩy (Web Push, không phải email):** tiêu đề "NomadCare: sắp vào vùng mất sóng", nội dung "Khoảng N phút nữa. Mở NomadCare để gửi toạ độ cho người thân." (theo ngôn ngữ lúc đăng ký, VI hoặc EN). Không có toạ độ, tên hay số điện thoại; hết hạn sau N phút. Bấm vào thì mở app ở Bản đồ và hiện cửa sổ gửi toạ độ.

## 4. Kịch bản demo gợi ý (5 phút, cho vòng thi)

1. **Trang chủ** (`?demo=1`): hàng 5 module, thẻ Buddy, thẻ tuyến Hà Giang Loop (dải màu sóng Viettel, "N vùng mất sóng · tổng X km", *Mở bản đồ*); danh sách chuẩn bị và thời tiết gập sẵn. Nếu hiện thẻ "Cho phép dùng vị trí?", bấm *Cho phép* hoặc *Để sau*.
2. **MOD.01**: Trang chủ → *Dịch y tế* → chạm *Ngực* trên hình cơ thể → *Khó thở* → *Nặng*: 4 chạm, màn hình song ngữ chữ lớn kèm dải *Cấp cứu — gọi 115* (bật *Bấm giờ Dịch y tế* trong Cài đặt → *Thử nghiệm thực địa* để hiện đồng hồ bấm giờ).
3. **MOD.02**: Mèo Vạc → TP. Hà Giang, so sánh *Ngắn nhất* (qua Du Già) và *Ưu tiên có sóng* (qua Yên Minh) — chi tiết trong *Xem thêm*; bấm *Bắt đầu đi* để hẹn nhắc trước vùng mất sóng; mở tab *Y tế gần nhất*. Có mạng: gõ một địa điểm ngoài tuyến rồi nhấn Enter để thử tìm đường trực tuyến (đoạn ngoài hành lang tô xám).
4. **MOD.04**: bật Buddy (hồ sơ demo chỉ điền sẵn tên và số di động `+84 000 000 001`, **không điền email**: giám khảo đi đúng luồng thật — phiên chỉ có SĐT, máy chủ không tự báo, app đưa nút *Gửi SMS*; muốn xem thêm đường email thì tự nhập một địa chỉ, `@example.com` luôn chỉ là mô phỏng. Nhập số máy bàn `02x` sẽ bị chặn với lời nhắc nhập số di động), chu kỳ "2 phút (demo)" → mở *Chế độ demo* → *Mô phỏng hành trình* ×60 → *Chạy*: mô phỏng tự bắt đầu ngay trước vùng mất sóng đầu tiên của lộ trình (kể cả lộ trình *Ưu tiên có sóng* từ bước 3) → cửa sổ "Sắp vào vùng mất sóng … Gửi toạ độ cho người thân?" (hành trình tạm dừng tới khi đóng cửa sổ; *Gửi SMS* với số demo chỉ hiện toast) → mạng tự chuyển offline, vị trí lúc mất sóng vào hàng đợi. Tuỳ chọn *Dừng trong vùng mất sóng tới khi quá hạn* (bật sẵn) giữ người đi trong vùng mất sóng tới khi quá hạn (~3 phút sau khi bật Buddy): máy chủ phát hiện quá hạn dù điện thoại không có sóng — phiên demo chỉ có SĐT nên máy chủ không gửi gì, app nhắc bấm *Gửi SMS*; nếu đã nhập email thì ở chế độ cục bộ email cảnh báo là *mô phỏng*, ở chế độ Supabase với email thật thì email được gửi thật. Mở Dashboard ở bước 5 để thấy phiên nổi đỏ; bấm *Đi tiếp ngay* để rút ngắn. Ra khỏi vùng → có sóng lại, hàng đợi tự gửi, toast "Có sóng trở lại — … sự kiện trong hàng đợi đã lên máy chủ". Nút *Mô phỏng: sắp vào vùng mất sóng* trong cùng mục mở ngay cửa sổ nhắc.
5. **Dashboard** (tab bên cạnh) → *Giám sát Buddy*: phiên quá hạn nổi đỏ đầu danh sách (SOS và *Mất liên lạc bất thường* có nhãn riêng). Phiên demo chỉ có SĐT: thẻ ghi phiên không có email người nhận, máy chủ không gửi cảnh báo tự động và nhắc gọi người nhận (nút *Gửi cảnh báo ngay* bị tắt). Phiên có email: nếu cron (15 giây ở chế độ cục bộ) chưa chạy tới, bấm *Gửi cảnh báo ngay*. Nếu đã tự chạy, thẻ ghi *Cảnh báo (mô phỏng)* với dòng "Email cảnh báo mô phỏng lúc … (chế độ cục bộ không gửi email thật)", và nút đổi thành *Gửi lại cảnh báo* (chỉ mô phỏng thêm một email). Địa chỉ minh hoạ như `ten@example.com` cũng luôn là mô phỏng, kể cả ở chế độ Supabase. Chỉ chế độ Supabase với email thật mới ghi *Đã gửi cảnh báo* và "Máy chủ đã tự động gửi email (cron)". Phiên chỉ có SĐT thì không có email tự động, thẻ nhắc gọi người nhận. Sau đó *Đánh dấu đã xử lý*.
6. **Nút Khẩn cấp** → *Hồ sơ y tế QR* → chế độ người cứu hộ; giữ để hiện lớp định danh.
7. Bật **Giả lập mất sóng** và lặp lại bước 2 để chứng minh mọi thứ vẫn chạy offline; trên Bản đồ, nếu đã tải *Nền bản đồ offline* ở thẻ *Gói dữ liệu*, nền vector (đường, sông suối, địa danh) thay cho ảnh nền.

## 5. Cấu trúc thư mục

```
index.html · admin.html · sw.js · manifest.webmanifest
assets/css/      tokens.css (màu, cỡ chữ) · base · components (.page-intro, .disclosure…) · layout · modules/*.css · admin.css
                 responsive.css  ← toàn bộ quy tắc cho tablet / PC / màn hình nhỏ
                 print.css · fonts.css
assets/js/core/      tiện ích, i18n VI/EN, icon SVG, lưu trữ, mã hoá, mạng, UI
assets/js/services/  định tuyến A* (routing), định vị (geo), tìm đường trực tuyến (geo-online), nền bản đồ offline
                     (basemap), nhắc trước vùng mất sóng + heartbeat (tripwatch), Web Push (push), hồ sơ y tế,
                     backend cục bộ + Supabase, lớp dữ liệu, bản đồ (mapkit)
assets/js/app/       router + từng màn hình (home, onboarding, settings, mod01…mod05)
assets/js/admin/     dashboard quản trị
assets/js/data/      seed-core.js, seed-admin.js (sinh tự động) · phrases.js (MOD.01) · firstaid.js (MOD.05)
assets/data/basemap/ nền bản đồ offline dạng vector, mỗi tuyến một JSON (sinh tự động, không precache)
assets/img/          logo.svg · favicon.svg · icons/ (favicon-16/32 px, apple-touch-icon, icon-192/512, maskable, shortcut-96)
                     · illustrations/ (onboarding, trạng thái trống)
assets/fonts/ (Be Vietnam Pro) · assets/vendor/ (Leaflet, qrcodejs, supabase-js)
supabase/        migrations, seed.sql, setup_all.sql, Edge Function deadman-alert + push-dispatch, hướng dẫn cài đặt
tools/seed/      sinh dữ liệu mẫu từ hình học đường thật (OSRM/OSM) · build_basemap.py (nền offline từ Overpass)
tools/tests/     test thuật toán + lớp dữ liệu (node --test) · tools/db-test/ test SQL trên PostGIS + Edge Function
mockup/          bộ dựng mockup (ảnh PNG + trang showcase) từ ảnh chụp app thật
docs/ui-kit.html thư viện thành phần giao diện
nomadcare-full_24.html   bản demo gốc (giữ nguyên để tham chiếu)
```

## 6. Kiểm thử

```bash
node --test tools/tests
```

```bash
bash tools/db-test/run.sh --help
bash tools/db-test/edge/run.sh
```

```bash
python3 tools/seed/build_seed.py --check
python3 tools/seed/build_basemap.py --check
```

Kết quả lần chạy gần nhất (02/10/2026): `node --test` 131/131 test đạt; bộ SQL trên PostgreSQL 18 + PostGIS đạt hết (719 phép kiểm trên database chạy migrations, 706 trên database chạy `setup_all.sql`, so khớp 9 gói dữ liệu với bản dựng của trình duyệt); Edge Function `deadman-alert` và `push-dispatch` qua `tsc --strict` và chạy với Deno/Resend/web-push giả.

Đã kiểm tra trên Chrome, WebKit (nhân Safari, giả lập iPhone/iPad) và Firefox; ở 390×844, 834×1194, 1440×900 và màn 320–360 px; sáng/tối; VI/EN; offline.

## 7. Triển khai

Là site tĩnh: đưa cả thư mục lên GitHub Pages / Netlify / Vercel / Cloudflare Pages (cần **HTTPS** để cài PWA, dùng GPS, service worker và thông báo). Trước khi phát hành phiên bản mới, cập nhật danh sách file cache offline và mã phiên bản cache trong `sw.js` (thư mục `assets/data/basemap/` cố ý không nằm trong danh sách):

```bash
python3 tools/build/precache.py
```

Nộp bài bằng file zip: thư mục dự án không phải git repo nên `.gitignore` không tự có tác dụng. Chạy lệnh dưới ở thư mục gốc dự án để bỏ đúng các mục trong `.gitignore` (cache Overpass, `mockup/node_modules/` khoảng 46 MB, `.DS_Store`). Bản zip khoảng 46 MB, phần lớn là ảnh mockup trong `mockup/screens/` và `mockup/export/`:

```bash
zip -r -q -X ../nomadcare.zip . -x 'mockup/node_modules/*' '*.DS_Store' 'tools/seed/cache/overpass-*.json'
```

## 8. Mã nguồn mở và dữ liệu sử dụng

Leaflet (BSD-2-Clause) · qrcodejs (MIT) · supabase-js (MIT) · web-push (MIT, trong Edge Function) · Be Vietnam Pro (SIL OFL 1.1) · biểu tượng theo phong cách Lucide (ISC) · dữ liệu bản đồ và nền offline © OpenStreetMap contributors (ODbL) · tìm kiếm Nominatim, dẫn đường OSRM (FOSSGIS `routing.openstreetmap.de`) · tuyến đường mẫu lấy từ OSRM/OSM.

## 9. Hạn chế đã biết (cần nhóm quyết định / làm tiếp)

- **Nội dung y tế** (câu dịch MOD.01, sơ cứu MOD.05, phiên bản `1.1.0-demo`) chưa được cố vấn y tế ký duyệt; bản dịch zh/ko/ja/ru/fr nên có người bản ngữ rà lại và dịch ngược đối chiếu. Năm xuất bản tài liệu Hội Chữ thập đỏ Việt Nam đang để trống ("chưa xác định năm") — cần nhóm bổ sung trong `assets/js/data/firstaid.js` và `phrases.js`.
- **Email cảnh báo**: đã có giới hạn tần suất và làm sạch tên, nhưng chưa có bước người nhận xác nhận (double opt-in) trước email đầu tiên — nên làm trước khi mở cho người dùng thật (xem `supabase/README.md`).
- **Web Push** mới chạy với dịch vụ giả (chưa có project Supabase và khoá VAPID thật). Không có push thì lời nhắc trước vùng mất sóng chỉ hiện khi app còn mở; trên iOS cần cài PWA ra màn hình chính.
- **Mất liên lạc bất thường** dựa vào tín hiệu `paused` gửi lúc ẩn app; nếu tín hiệu này bị mất, phiên còn `live` có thể bị báo nhầm sau 15 phút.
- **Tìm đường trực tuyến** dùng dịch vụ công cộng miễn phí (Nominatim, OSRM FOSSGIS) có giới hạn sử dụng; OSRM không có hồ sơ xe máy nên có thể chọn đường cấm xe máy. Khi có nhiều người dùng thật cần máy chủ riêng (đổi URL trong `config.js`).
- **Tải lần đầu** khá nặng (~750 KB JS nén) vì nội dung offline đi kèm; sau lần đầu app chạy từ cache. Có thể tối ưu bằng cách nạp lười `phrases.js`/`firstaid.js` sau khi trang chủ hiển thị. Trên Safari, service worker tải lại toàn bộ app một lần khi cài.
- **Chưa chạy trên Supabase/Resend thật** trong quá trình phát triển (đã kiểm thử bằng PostgreSQL + PostGIS cục bộ với lớp giả lập Supabase); cần chạy thử theo `supabase/README.md` trước buổi demo.
- Dữ liệu điểm y tế, lớp sóng, phiên Buddy là **minh hoạ**; ngày xác thực điểm y tế là cố định, sau khoảng 11/2026 nhiều điểm sẽ hiện "quá 90 ngày" — sinh lại seed với mốc mới bằng `tools/seed/build_seed.py`.
