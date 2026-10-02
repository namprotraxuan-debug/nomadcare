# NomadCare — bộ mockup giao diện (AISC 2026, vòng 2)

Thư mục này tạo "bản phác thảo (mockup) giao diện sản phẩm demo" từ **ảnh chụp thật** của app đang chạy:

- `export/*.png`: các board độ phân giải cao cho slide và poster.
- `index.html`: trang showcase để chiếu khi thuyết trình (có phóng to, song ngữ VI/EN, chế độ xem trực tiếp).

Mọi thứ nằm trong `mockup/`. Script không sửa file nào của app.

## Chạy nhanh

```bash
cd mockup
npm i                       # bắt buộc lần đầu: cài puppeteer-core vào mockup/node_modules
node build-mockup.js all    # chụp mọi trạng thái rồi render mọi board (vài phút)
```

Không cần tự bật server: script tự chạy một static server trỏ vào thư mục gốc dự án (cổng ngẫu nhiên, chỉ `127.0.0.1`) và tự mở Chrome headless.

Profile Chrome được giữ giữa các lần chạy (`--profile`, mặc định `<thư mục tạm của hệ điều hành>/nomadcare-mockup-profile`, ví dụ `$TMPDIR/nomadcare-mockup-profile` trên macOS). Tile bản đồ tải từ máy chủ bên ngoài (OpenStreetMap) được lưu trong `<profile>/tile-cache` và dùng lại ở lần chạy sau, tối thiểu 7 ngày hoặc lâu hơn nếu header `Cache-Control` cho phép. Lý do: chính sách sử dụng tile của OSM cấm tải hàng loạt tự động, nên chạy lại script không được tải lại cùng một tile. Mỗi shot chạy trong browser context ẩn danh riêng, mà context ẩn danh chỉ có cache HTTP trong RAM, nên script tự trả tile từ `tile-cache` thay vì dựa vào cache của Chrome. Xoá thư mục profile nếu muốn tải tile mới. Nếu profile đang bị một lần chạy khác giữ, script báo cảnh báo rồi dùng profile tạm (khi đó vẫn đọc và ghi `tile-cache`).

Khi sửa một shot, chỉ chụp lại shot đó: `node build-mockup.js shots --only p-map-start`.

| Lệnh | Việc làm |
|---|---|
| `node build-mockup.js shots` | Chụp mọi trạng thái trong `shots.json` → `screens/<id>.png` |
| `node build-mockup.js boards` | Render `boards.html#<board>` → `export/<file>.png` |
| `node build-mockup.js all` | `shots` rồi `boards` |
| `node build-mockup.js placeholders` | Tạo ảnh tạm cho shot chưa có ảnh (`--force` để ghi đè) |
| `node build-mockup.js data` | Chỉ cập nhật `data.js` sau khi sửa `shots.json` |
| `node build-mockup.js list` | Liệt kê shot nào đã có ảnh thật / ảnh tạm / lỗi |

Tuỳ chọn:

- `--only p-home,t-map` chỉ chụp các id này.
- `--device phone|tablet|desktop` chỉ chụp một loại thiết bị.
- `--board mobile,dark` chỉ render các board này.
- `--scale 2` xuất board gấp đôi pixel, ví dụ 8000 × 2500 để in poster.
- `--lang en` xuất chữ trên board bằng tiếng Anh.
- `--parallel 3` số trang chụp song song.
- `--keep` vẫn lưu ảnh khi một action bắt buộc bị lỗi.
- `--verbose` in lỗi console của app.
- `--base http://localhost:8099` chụp từ một server có sẵn thay cho server nội bộ.
- `--profile DIR` thư mục profile Chrome và `tile-cache` (mặc định `<tmpdir>/nomadcare-mockup-profile`).

### Yêu cầu

- Node 18 trở lên.
- Google Chrome tại `/Applications/Google Chrome.app/…`. Nếu Chrome ở chỗ khác, đặt biến `CHROME_PATH=/đường/dẫn/chrome`.
- `puppeteer-core` (khai báo trong `package.json`): chạy `cd mockup && npm i` một lần. Script chỉ tìm trong `mockup/` và `mockup/node_modules`.
- Bản đồ cần mạng ở lần chạy đầu để tải tile OSM. Không shot nào gọi Nominatim hay OSRM (tìm kiếm và định tuyến trực tuyến): các shot bản đồ dùng deep link tới tuyến offline `hg-meo-vac → hg-ha-giang`.

## Đầu ra

| Đường dẫn | Nội dung |
|---|---|
| `screens/<id>.png` | Ảnh chụp gốc (điện thoại @3x, máy tính bảng và desktop @2x) |
| `screens/thumb/<id>.webp` | Ảnh thu nhỏ cho trang showcase |
| `screens/manifest.json` | Thông tin mỗi ảnh: thời điểm chụp, màu thanh trạng thái, toạ độ chạm, lỗi của lần chạy gần nhất |
| `screens/_failed/<id>.png` | Ảnh tại lúc lỗi, để dò selector (ảnh cũ trong `screens/` được giữ nguyên) |
| `export/*.png` | Board thành phẩm |
| `export/thumb/*.webp` | Ảnh xem trước board cho mục "Tải về" |
| `data.js` | Bản chụp của `shots.json` và manifest. File này sinh tự động, không sửa tay |

Một shot lỗi chỉ in cảnh báo, các shot khác vẫn chạy. Nếu shot chưa từng có ảnh, board vẽ một khung "Chưa có ảnh chụp" gọn gàng ở chỗ đó.

## Các board

| Board | File | Kích thước (px) | Nội dung |
|---|---|---|---|
| `mobile` | `board-mobile.png` | 4000 × 1250 | Nền gradient thương hiệu, tiêu đề "GIAO DIỆN DI ĐỘNG", 9 iPhone: onboarding, trang chủ, hình cơ thể MOD.01, kết quả MOD.01, lộ trình, QR, Buddy, sơ cứu, khẩn cấp |
| `mobile-2` | `board-mobile-2.png` | 4000 × 1250 | Biến thể nền sáng với tab tiêu đề "GIAO DIỆN", 9 iPhone: đồng ý dữ liệu y tế, xin quyền vị trí, gợi ý nền bản đồ offline, "Bắt đầu đi", y tế gần nhất, thiết lập Buddy chỉ cần số điện thoại, popup trước vùng mất sóng, chế độ cứu hộ, sơ cứu từng bước |
| `tablet` | `board-tablet.png` | 3840 × 2160 | 3 iPad: trang chủ, bản đồ, kết quả MOD.01 |
| `desktop` | `board-desktop.png` | 3840 × 2160 | Laptop (trang chủ web, sidebar đầy đủ) và 5 cửa sổ trình duyệt (bản đồ với sidebar thu gọn thành thanh biểu tượng, Buddy, admin tổng quan, giám sát Buddy, bản đồ nhiệt sóng) |
| `flow-mod01` | `board-flow-mod01.png` | 3840 × 2160 | 5 bước MOD.01, thời gian ~2/3/6/2 giây, vòng chạm, thanh 0–15 giây, mục tiêu "< 15 giây, không cần nhập chữ, không cần mạng" |
| `dark` | `board-dark.png` | 4000 × 1320 | 7 màn hình chế độ tối |
| `overview` | `board-overview.png` | 3840 × 2160 | Board tổng hợp: laptop, iPad và 3 iPhone, kèm chú giải 5 module |

Kích thước, danh sách màn hình và tiêu đề của từng board nằm trong `shots.json` → `boards`. Bố cục nằm trong `boards.js`, khung thiết bị trong `mockup.css` và `mk-common.js`. Để xem một board trong trình duyệt, mở `boards.html#mobile`; mở `boards.html` không kèm `#` để xem danh sách board.

## Sửa `shots.json`

Mỗi shot có các trường sau:

```json
{
  "id": "p-tr-result",
  "device": "phone",
  "url": "/index.html?demo=1#/translate",
  "theme": "light",
  "lang": "vi",
  "offline": true,
  "extends": "p-tr-severity",
  "actions": [ { "wait": 700 } ],
  "caption": { "vi": "Màn hình song ngữ cho nhân viên y tế", "en": "Bilingual screen for medical staff" },
  "module": "MOD.01"
}
```

- `device`: `phone` (390 × 844 @3x, có giả lập safe-area của iPhone), `tablet` (834 × 1194 @2x) hoặc `desktop` (1440 × 900 @2x).
- `url`: tính từ gốc dự án. `theme`, `lang` và `offline` tự thêm `?theme=`, `?lang=`, `?offline=1` nếu URL chưa có.
- `extends`: kế thừa URL và các action của shot khác. Bước `tap` của shot cha được đổi thành `click`, nên chuỗi MOD.01 chỉ cần viết mỗi bước một lần.
- `module`: `MOD.01` … `MOD.05`, `Trang chủ`, `Onboarding`, `Admin`, `Khẩn cấp`, `Cài đặt`. Giá trị này quyết định màu thẻ trên board.
- `geo` (tuỳ chọn): mặc định script cấp quyền vị trí và thông báo cho origin của app, rồi đặt vị trí `defaults.geo` (22.99, 104.98, trên Hà Giang Loop). Vì vậy app không hiện thẻ xin quyền vị trí. `"geo": false` giữ trạng thái mặc định của trình duyệt (chưa hỏi), dùng cho shot `p-geo-permission`. `"geo": {"latitude": …, "longitude": …}` đặt vị trí khác.
- `live` (tuỳ chọn): URL dùng cho chế độ "Xem trực tiếp" của showcase, ví dụ để thay luồng `?reset=1`.

Các action chạy lần lượt. Thêm `"optional": true` để lỗi chỉ thành cảnh báo:

| Action | Ý nghĩa |
|---|---|
| `{"goto": "/index.html"}` | Mở URL khác |
| `{"hash": "#/map"}`, `{"go": "map", "params": {...}}` | Chuyển màn hình (`go` gọi `NC.app.go`) |
| `{"click": "#fab-emergency"}` | Bấm theo CSS selector |
| `{"clickText": "Nặng\|Severe", "within": "#screen-translate", "sel": "[data-severity='severe']"}` | Thử `sel` trước. Nếu không có, bấm phần tử nhỏ nhất có chữ khớp (các phương án cách nhau bằng `\|`). `selector` giới hạn loại phần tử, `index` chọn kết quả thứ n |
| `{"tap": {...}}` | Giống `clickText` nhưng không bấm, chỉ ghi vị trí để vẽ vòng chạm trên board luồng |
| `{"eval": "..."}` | Chạy JS trong trang (có thể async). Có sẵn `__mk.find`, `__mk.click`, `__mk.go`, `__mk.waitFor`, `__mk.sleep` |
| `{"waitFor": "css"}`, `{"waitText": "…"}`, `{"wait": 800}` | Chờ |
| `{"scrollTo": "Quyền riêng tư"}`, `{"scroll": {"selector": "#view", "y": 400}}` | Cuộn |
| `{"tiles": true}`, `{"idle": 6000}` | Chờ tile bản đồ Leaflet / chờ mạng rảnh |
| `{"css": "…"}`, `{"type": ["css", "chữ"]}`, `{"press": "Enter"}`, `{"offline": true}` | Các action phụ |
| `{"macro": "buddyStart"}` | Chèn một nhóm action trong `macros`: `buddyStart` bật phiên Buddy, `packDownload` tải gói tuyến hiện tại, `homePrep` = cả hai rồi mở trang chủ, `adminEnterDemo` bấm `#ad-demo`, `mapDismissBasemap` chờ sheet "Tải nền bản đồ offline?" rồi bấm "Để sau", `tabbarShow` cuộn lên một chút để thanh tab (tự ẩn khi cuộn xuống) hiện lại, `blurFocus` bỏ focus (vòng focus trên nút trong sheet/popup), `translateLegs` mở MOD.01 và chọn vùng chân |

Trước khi chụp, script chờ font (`document.fonts.ready`), ảnh và tile bản đồ, bỏ focus, ẩn thanh cuộn và con trỏ nhập. Nếu shot có bấm bằng chuột, script đưa chuột ra góc trên bên phải để phần tử vừa bấm không giữ hiệu ứng hover. Mỗi shot chạy trong một browser context riêng, nên dữ liệu (IndexedDB/localStorage) không lẫn giữa các shot.

Selector đang dùng lấy từ DOM thật của app (giao diện sau đợt sửa vòng 2, kiểm tra ngày 2026-10-02):

| Màn hình | Selector / API |
|---|---|
| Trang chủ | hàng module `#screen-home .hm-mods a[href='#/translate']` (cũng có `#/map`, `#/qr`, `#/buddy`, `#/firstaid`), `#fab-emergency` |
| Xin quyền vị trí | `.geo-sheet.is-open` (nút "Để sau" / "Cho phép"); chỉ hiện khi chưa cấp quyền, tức shot có `"geo": false` |
| MOD.01 | vùng cơ thể (không còn thẻ vùng) `#screen-translate [data-tr-act='group'][data-id='head\|chest\|abdomen\|arms\|legs\|skin']`, là các nút `.tr-hot--<vùng>` trên hình và nút `.tr-skin` "Da & toàn thân"; thêm class `is-hot is-press` vào `.tr-hot--chest` để hiện nhãn như khi đang chạm; `[data-tr-act='symptom'\|'child'\|'sev'][data-id=…]`; chi tiết kết quả nằm trong disclosure `#screen-translate .tr-result__more > summary.disclosure__sum` ("Xem thêm") |
| MOD.02 | deep link `#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half\|full`; tuyến có vùng mất sóng nên app tự mở sheet `.mk-bm-sug.is-open` ("Tải nền bản đồ offline?"); `#mp-result`, nút "Bắt đầu đi" `#screen-map .mp-trip` (`data-mp="trip-start"`), `#mp-med-filter` |
| MOD.04 | form `#bd-form`, `#bd-form .bd-fieldset` (người nhận), `#bd-f-rphone` (bắt buộc), `#bd-f-remail` (tuỳ chọn); trình mô phỏng nằm trong disclosure "Chế độ demo" `#bd-demo` (đóng mặc định): gọi `NC.buddy.openDemo()` trước khi cuộn tới `#bd-s-play`, rồi `NC.buddy.sim.setSpeed()/seek()/play()`; popup trước vùng mất sóng `NC.buddy.demoAlert()` → `.tw-pop-modal.is-open` (KHÔNG `await`: promise chỉ xong khi đóng popup) |
| MOD.05 | `#/firstaid?item=cpr&tool=cpr` + `NC.firstaid.metronome.start()` ("Đếm nhịp ép tim"), `#screen-firstaid .fa-steps__head` |
| Desktop | `NC.app.setNavCollapsed(true)` thu sidebar thành thanh biểu tượng 88 px |
| Khác | `#ob-root .ob-step`, `#ob-next`, `#ad-demo` |

Các shot thêm ở vòng 2:

| Shot | Trạng thái | Board |
|---|---|---|
| `p-geo-permission` | Sheet "Cho phép dùng vị trí?" khi mở app (`"geo": false`) | `mobile-2` |
| `p-tr-figure` | MOD.01 bước 1 chỉ còn hình cơ thể, nhãn "Chest / Ngực" như khi đang chạm | `mobile` |
| `p-map-basemap` | Tuyến Mèo Vạc → TP. Hà Giang qua vùng mất sóng, sheet gợi ý tải nền bản đồ offline | `mobile-2` |
| `p-map-start` | Kết quả lộ trình (panel mở hết) với nút "Bắt đầu đi" | `mobile-2` |
| `p-buddy-setup` | Form Buddy: số điện thoại bắt buộc, ô email để trống (tuỳ chọn) | `mobile-2` |
| `p-buddy-alert` | Popup "Nhắc trước vùng mất sóng" (`NC.buddy.demoAlert()`) khi Buddy đang bật | `mobile-2` |
| `d-nav-collapsed` | Desktop 1440: bản đồ + lộ trình, sidebar thu gọn thành thanh biểu tượng | `desktop` |

Shot cũ không còn trên board nào nhưng vẫn được chụp và hiện trong showcase: `p-buddy-sim` (trình mô phỏng giờ nằm trong "Chế độ demo"), `p-settings-privacy`, `d-map`.

Khi selector sai: chạy `node build-mockup.js shots --only <id> --verbose`, xem `screens/_failed/<id>.png` và `lastRun` trong `screens/manifest.json`. Sau đó sửa `sel` hoặc chữ trong `clickText`.

## Trang showcase (`index.html`)

- Mở trực tiếp file `mockup/index.html` là xem được ảnh chụp, không cần server.
- Để dùng nút **Xem trực tiếp** (thay ảnh bằng iframe của app thật, thu phóng đúng kích thước thiết bị), phục vụ **từ thư mục gốc dự án**:
  ```bash
  python3 -m http.server 8099      # chạy tại /Users/windy/Music/Workspace/nomadcare
  # rồi mở http://localhost:8099/mockup/
  ```
  Ở chế độ này, các action được phát lại ở mức tối giản. Luồng `?reset=1` và `?offline=1` bị bỏ qua để các khung không xoá dữ liệu hay tắt mạng của nhau.
- Có nút VI/EN, lọc theo module, lightbox (phím ← → Esc) và mục tải board PNG.

## Ảnh tạm (placeholder)

`node build-mockup.js placeholders` tạo ảnh giả mang phong cách thương hiệu, có dải cam "PLACEHOLDER · ảnh tạm", để dựng board khi app chưa xong. `node build-mockup.js shots` ghi đè các ảnh này bằng ảnh thật. Lệnh `list` cho biết shot nào vẫn đang là ảnh tạm.

## Ghi chú

- Mọi dữ liệu trong ảnh là dữ liệu minh hoạ (`is_demo`). Số điện thoại demo dùng mẫu `+84 000 000 0NN`.
- Script tắt service worker của app cho trang chụp (`page.setBypassServiceWorker`), nên mọi request đi thẳng ra mạng và tile được đọc từ `tile-cache`.
- Thanh địa chỉ của khung trình duyệt hiển thị `nomadcare.demo`. Đổi bằng trường `browserHost` trong `shots.json`.
- Logo lấy từ `../assets/img/logo.svg`. Nếu file không có, board dùng biểu tượng dựng sẵn.
