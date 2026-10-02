/*
 * mod02-map.js — MOD.02 "Bản đồ & định tuyến offline" (owner: P2 mod02-map, prefix mp-).
 * Full-height Leaflet map (NC.mapkit) + draggable bottom panel on phones (peek/half/full) / side panel from 768 px.
 * Hybrid routing (round 2 R4): both ends within 5 km of the pilot corridors → A* over the offline pack graph
 * (NC.routing) coloured by the carrier's signal layer, shortest vs signal-first comparison; otherwise, ONLINE and after
 * the one-time consent → an OSRM route (NC.geoOnline) whose stretches along a pilot edge take that edge's signal level
 * and the rest is 'unknown' (grey); offline and farther than 30 km → "Cần mạng" card (5–30 km: offline estimate with a
 * straight approach leg, as before). Search = pilot nodes + verified facilities + services, plus Nominatim results
 * when online (only on Enter / the "Tìm …" row — no autocomplete, Nominatim policy). The From field is a combobox too (Vị trí của tôi | search | map).
 * Result card: headline, dead-zone summary, "Bắt đầu đi" (NC.trip.start(plan), C2) / "Gửi vị trí"
 * (NC.trip.promptShare), details folded in "Xem thêm". Nearest verified facilities, stops along the route, data packs.
 * One "Lớp bản đồ" menu (FAB) toggles Sóng / Y tế / Dịch vụ / Nền offline; the offline vector basemap (NC.basemap,
 * managed in the packs tab) covers the map automatically when raster tiles are unavailable. Demo tools (simulated
 * position) live in the collapsed "Chế độ demo" disclosure at the end of the Route tab.
 * Public API: NC.map = {open(params), route(from, to, opts), lastRoute(), state()}. Saves the last computed route
 * to NC.store kv 'map.last_route' {route_id, carrier, from, to, strategy, mode, at, source, …, plan: TripPlan (C2)}
 * and emits bus 'map:route'.
 */
(function (NC) {
  'use strict';

  if (!NC.app || !NC.util || !NC.ui) return;

  var U = NC.util;
  var esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function ic(n, c) { return NC.ui.icon(n, c); }
  function R() { return NC.routing; }

  /* ================================================================== i18n */
  NC.i18n.add({
    vi: {
      'mp.map_aria': 'Bản đồ tuyến, lớp sóng và cơ sở y tế',
      'mp.panel_aria': 'Bảng lộ trình và thông tin tuyến',
      'mp.panel.grip': 'Kéo hoặc nhấn để thay đổi kích thước bảng',
      'mp.chip.route': 'Tuyến', 'mp.chip.route_aria': 'Tuyến đang chọn: {name}. Nhấn để đổi',
      'mp.layers.aria': 'Lớp bản đồ', 'mp.layers.signal': 'Sóng', 'mp.layers.med': 'Y tế', 'mp.layers.svc': 'Dịch vụ',
      'mp.layers.btn': 'Lớp bản đồ', 'mp.layers.vbase': 'Nền offline',
      'mp.layers.signal_sub': 'Mức sóng dọc tuyến', 'mp.layers.med_sub': 'Cơ sở y tế đã xác minh', 'mp.layers.svc_sub': 'Lưu trú, xăng, sửa xe, thuê xe',
      'mp.layers.vbase_none': 'Chưa tải — tải ở thẻ Gói dữ liệu', 'mp.layers.vbase_auto': 'Tự bật khi không có ảnh nền',
      'mp.layers.vbase_on': 'Đang hiển thị', 'mp.layers.vbase_off': 'Đã tắt — nhấn để bật lại',
      'mp.layers.vbase_away': 'Ngoài vùng đã tải — chỉ có quanh tuyến đã tải',
      'mp.layers.vbase_temp': 'Đang hiển thị tạm vì ảnh nền bị chặn — tải ở thẻ Gói dữ liệu để dùng khi mất sóng',
      'mp.fab.locate': 'Định vị bằng GPS', 'mp.fab.sim': 'Vị trí mô phỏng', 'mp.fab.fit': 'Xem toàn tuyến',
      'mp.zoom_in': 'Phóng to', 'mp.zoom_out': 'Thu nhỏ',
      'mp.legend.likely': 'Có sóng', 'mp.legend.uncertain': 'Không chắc', 'mp.legend.lost': 'Mất sóng', 'mp.legend.unknown': 'Chưa có dữ liệu sóng',
      'mp.legend.btn': 'Chú giải mức sóng', 'mp.key.title': 'Ký hiệu trên bản đồ', 'mp.key.stale': 'Viền cam: cần xác minh lại', 'mp.key.zone': 'Bắt đầu vùng mất sóng',
      'mp.demo.title': 'Chế độ demo', 'mp.demo.sub': 'Vị trí mô phỏng cho buổi trình diễn',
      'mp.demo.text': 'Cho buổi trình diễn hoặc khi GPS chưa bắt được: đặt vị trí mô phỏng trên tuyến. Mẹo: nhấn giữ (hoặc chuột phải) trên bản đồ để đặt vị trí bất kỳ.',
      'mp.tab.route': 'Lộ trình', 'mp.tab.med': 'Y tế gần nhất', 'mp.tab.stops': 'Điểm dừng', 'mp.tab.packs': 'Gói dữ liệu',
      'mp.plan.from': 'Từ', 'mp.plan.to': 'Đến', 'mp.plan.to_ph': 'Tìm điểm đến…',
      'mp.plan.me_sim': 'Vị trí mô phỏng', 'mp.plan.me_gps': 'Vị trí GPS', 'mp.plan.me_none': 'Chưa có vị trí',
      'mp.plan.me': 'Vị trí của tôi', 'mp.plan.from_ph': 'Chọn điểm xuất phát…', 'mp.plan.from_clear': 'Xoá điểm xuất phát',
      'mp.plan.swap': 'Đảo chiều điểm đi và điểm đến', 'mp.plan.clear': 'Xoá điểm đến',
      'mp.plan.mode': 'Phương tiện', 'mp.plan.strategy': 'Chiến lược định tuyến',
      'mp.mode.motorbike': 'Xe máy', 'mp.mode.hiking': 'Đi bộ',
      'mp.strategy.shortest': 'Ngắn nhất', 'mp.strategy.signal': 'Ưu tiên có sóng',
      'mp.plan.nearest_fac': 'Cơ sở y tế gần nhất',
      'mp.combo.facs': 'Cơ sở y tế đã xác minh', 'mp.combo.nodes': 'Địa điểm trên tuyến', 'mp.combo.none': 'Không tìm thấy “{q}”',
      'mp.combo.svcs': 'Dịch vụ dọc tuyến', 'mp.combo.here': 'Vị trí',
      'mp.combo.me_gps': 'GPS · ±{m} m · {ago}', 'mp.combo.me_none': 'Chạm để bật vị trí', 'mp.combo.me_denied': 'Trình duyệt đang chặn vị trí',
      'mp.combo.me_na': 'Thiết bị không cung cấp vị trí',
      'mp.combo.pick': 'Chọn trên bản đồ', 'mp.combo.pick_meta': 'Chạm vào một điểm trên bản đồ',
      'mp.combo.online': 'Trực tuyến · OpenStreetMap', 'mp.combo.go': 'Tìm “{q}” trên toàn Việt Nam', 'mp.combo.go_meta': 'Nhấn Enter hoặc chọn dòng này',
      'mp.combo.consent': 'Tìm kiếm trực tuyến gửi vị trí và điểm đến tới dịch vụ OpenStreetMap (Nominatim/OSRM) — chỉ khi bạn tìm hoặc dẫn đường ngoài dữ liệu offline.',
      'mp.combo.consent_ok': 'Đồng ý và tìm', 'mp.combo.loading': 'Đang tìm trên OpenStreetMap…',
      'mp.combo.online_none': 'OpenStreetMap không có kết quả cho “{q}”.', 'mp.combo.online_err': 'Chưa tìm được trực tuyến ({why}) — chọn để thử lại',
      'mp.combo.offline_hint': 'Không có kết quả offline. Khi có mạng, bạn tìm được mọi địa điểm ở Việt Nam.',
      'mp.combo.attr': 'Kết quả tìm kiếm © OpenStreetMap contributors · Nominatim',
      'mp.err.timeout': 'quá thời gian chờ', 'mp.err.rate': 'dịch vụ đang quá tải', 'mp.err.offline': 'mất mạng', 'mp.err.http': 'lỗi máy chủ',
      'mp.err.parse': 'phản hồi không hợp lệ', 'mp.err.no_route': 'không có đường nối', 'mp.err.unsupported': 'trình duyệt không hỗ trợ', 'mp.err.consent': 'chưa đồng ý',
      'mp.pick.hint': 'Chạm vào bản đồ để chọn điểm xuất phát', 'mp.pick.cancel': 'Huỷ', 'mp.pick.done': 'Đã chọn điểm xuất phát trên bản đồ.',
      'mp.geo.denied': 'Trình duyệt đang chặn vị trí — chọn điểm xuất phát ở ô “Từ” (tìm hoặc chọn trên bản đồ).',
      'mp.geo.prompt': 'Bật vị trí để tìm đường từ chỗ bạn đang đứng.', 'mp.geo.enable': 'Bật vị trí',
      'mp.geo.unsupported': 'Trình duyệt không cung cấp vị trí ở đây (cần https) — chọn điểm xuất phát thủ công.',
      'mp.geo.kept': 'Vị trí thật cách tuyến thí điểm {d} — bản demo đang dùng vị trí mô phỏng.',
      'mp.on.consent_title': 'Tìm đường trực tuyến?',
      'mp.on.consent_text': 'Chặng này nằm ngoài 3 tuyến thí điểm. Tìm đường trực tuyến gửi vị trí và điểm đến tới dịch vụ OpenStreetMap (OSRM).',
      'mp.on.consent_ok': 'Đồng ý và tìm đường', 'mp.on.loading': 'Đang tìm đường trực tuyến…',
      'mp.on.err_title': 'Chưa tìm được đường trực tuyến', 'mp.on.err_text': 'Lý do: {why}. Thử lại sau ít giây.', 'mp.on.retry': 'Thử lại',
      'mp.on.net_title': 'Cần mạng để tìm đường ngoài 3 tuyến thí điểm',
      'mp.on.net_text': 'Offline, NomadCare chỉ tính đường trên gói dữ liệu của 3 tuyến thí điểm. {to} cách {from} khoảng {air} theo đường chim bay.',
      'mp.on.fallback': 'Ước tính offline: đoạn ngoài tuyến tính theo đường chim bay.',
      'mp.on.hint_net': 'Khi có mạng, NomadCare tìm được đường thật tới đây qua OpenStreetMap.',
      'mp.on.source': 'Đường đi: OSRM (FOSSGIS) · © OpenStreetMap contributors',
      'mp.on.unknown_note': 'Ngoài 3 tuyến thí điểm chưa có dữ liệu sóng: đoạn tô xám, không có nhắc trước ở đó.',
      'mp.on.single': 'Tuyến trực tuyến chỉ có một phương án — so sánh chiến lược chỉ có trên 3 tuyến thí điểm.',
      'mp.on.sum_loading': 'Đang tìm đường trực tuyến…', 'mp.on.sum_consent': 'Cần đồng ý để tìm đường trực tuyến',
      'mp.on.sum_net': 'Cần mạng để tìm đường', 'mp.on.sum_err': 'Chưa tìm được đường trực tuyến',
      'mp.res.empty_title': 'Chọn điểm đến',
      'mp.res.empty_text': 'Trên 3 tuyến thí điểm, lộ trình được tính ngay trên máy (không cần mạng) và tô màu theo sóng {carrier}. Khi có mạng, tìm được mọi nơi ở Việt Nam.',
      'mp.res.need_from': 'Chọn điểm xuất phát', 'mp.res.need_from_text': 'Chưa có vị trí của bạn — chọn điểm xuất phát ở ô “Từ”.',
      'mp.res.unknown': 'Chưa có dữ liệu', 'mp.res.more': 'Xem thêm', 'mp.res.more_sub': 'So sánh chiến lược, các đoạn theo mức sóng, điểm dừng',
      'mp.res.more_sub_on': 'Các đoạn theo mức sóng, điểm dừng',
      'mp.trip.start': 'Bắt đầu đi', 'mp.trip.stop': 'Đang đi · Kết thúc', 'mp.trip.share': 'Gửi vị trí',
      'mp.trip.na': 'Nhắc trước vùng mất sóng chưa có trong bản này.',
      'mp.trip.hint': 'Bắt đầu đi: nhắc trước mỗi vùng mất sóng ~{min} phút ({mode}), không theo dõi GPS liên tục.',
      'mp.trip.other': 'Đang có chuyến {from} → {to} — Bắt đầu đi sẽ thay chuyến đó.',
      'mp.dz.none_known': 'Không có vùng mất sóng đã biết', 'mp.dz.none_known_text': 'Đoạn chưa có dữ liệu sóng (màu xám) vẫn có thể mất sóng.',
      'mp.res.none_title': 'Không tìm được lộ trình',
      'mp.res.none_text': 'Hai điểm không nằm trên cùng mạng đường của gói dữ liệu. Hãy chọn hai điểm trên cùng một tuyến.',
      'mp.res.none_text_net': 'Hai điểm nằm trên hai tuyến thí điểm khác nhau. Khi có mạng, NomadCare tìm đường nối trực tuyến; ngoại tuyến hãy chọn hai điểm trên cùng một tuyến.',
      'mp.combo.live_n': '{n} kết quả trực tuyến từ OpenStreetMap',
      'mp.pos.far_real': 'Bạn đang cách tuyến thí điểm gần nhất {d} — lớp sóng chỉ có trên 3 tuyến; đoạn đường khác hiện màu xám (chưa có dữ liệu sóng).',
      'mp.res.via': 'qua {list}', 'mp.res.speed': '{mode} · {v} km/h',
      'mp.res.same': 'Tuyến ngắn nhất cũng là tuyến ít mất sóng nhất trên {carrier}.',
      'mp.res.off_end': 'Cơ sở cách đường chính {d} — đoạn cuối theo đường nhánh, đã cộng vào quãng đường.',
      'mp.res.off_end_pt': 'Điểm đến cách đường chính {d} — đoạn cuối ngoài tuyến, đã cộng vào quãng đường.',
      'mp.res.off_start': 'Bạn đang cách tuyến {d} — đoạn ra tới tuyến (chưa có dữ liệu sóng) đã cộng vào quãng đường.',
      'mp.res.off_start_pt': 'Điểm xuất phát cách tuyến {d} — đoạn ra tới tuyến (chưa có dữ liệu sóng) đã cộng vào quãng đường.',
      'mp.res.approach': 'gồm {d} ngoài tuyến',
      'mp.far.title_start': 'Bạn đang cách tuyến gần nhất {d}',
      'mp.far.title_end': 'Điểm đến cách tuyến gần nhất {d}',
      'mp.far.text': 'NomadCare chỉ tính lộ trình trên mạng đường của các tuyến thí điểm có trong gói dữ liệu offline, nên chưa ước tính được quãng đường, thời gian hay vùng mất sóng cho chuyến này. {to} cách {from} khoảng {air} theo đường chim bay.',
      'mp.far.sum': 'Cách tuyến {d} · chưa tính được đường đi',
      'mp.far.tts': 'Chưa tính được lộ trình: {from} cách tuyến gần nhất {d}. {to} cách khoảng {air} theo đường chim bay.',
      'mp.far.you': 'bạn',
      'mp.res.levels': 'Mức sóng dọc lộ trình',
      'mp.dz.title': 'Mất sóng sau {x} (~{t}) · dài {y}',
      'mp.dz.title_now': 'Bạn đang ở trong vùng mất sóng · còn {y}',
      'mp.dz.zones': '{n} vùng mất sóng trên lộ trình · dài nhất {max}',
      'mp.dz.soon': 'Sắp tới — hãy gửi vị trí ngay',
      'mp.dz.none_title': 'Không có vùng mất sóng dự kiến',
      'mp.dz.none_text': 'Theo lớp sóng {carrier}, toàn bộ lộ trình nhiều khả năng có sóng hoặc chưa chắc chắn.',
      'mp.dz.show': 'Xem trên bản đồ',
      'mp.cmp.title': 'So sánh chiến lược', 'mp.cmp.sub': 'Cùng điểm đi, điểm đến · đoạn mất sóng tính nặng ×2,5, không chắc ×1,5.',
      'mp.cmp.lost': '{km} mất sóng', 'mp.cmp.no_lost': 'Không mất sóng',
      'mp.cmp.verdict': 'Ưu tiên có sóng dài thêm {dk} (~{dt}) nhưng bớt {dl} đi trong vùng mất sóng ({p}%).',
      'mp.cmp.verdict_free': 'Ưu tiên có sóng bớt {dl} đi trong vùng mất sóng mà không dài hơn.',
      'mp.cmp.in_use': 'Đang dùng', 'mp.cmp.alt_tip': 'Lộ trình {name}: {km} · {lost} mất sóng — nhấn để chọn',
      'mp.parts.title': 'Các đoạn theo mức sóng', 'mp.parts.count': '{n} đoạn', 'mp.parts.km': 'km {a} – {b}',
      'mp.parts.more': 'Xem tất cả {n} đoạn', 'mp.parts.less': 'Thu gọn',
      'mp.along.title': 'Dọc lộ trình (≤ {km})', 'mp.along.all': 'Tất cả', 'mp.along.at': 'km {km}', 'mp.along.off': 'cách đường {d}',
      'mp.along.none': 'Không có cơ sở hay dịch vụ nào cách lộ trình dưới {km}.',
      'mp.act.speak': 'Đọc chỉ dẫn', 'mp.act.stop': 'Dừng đọc', 'mp.act.clear': 'Xoá lộ trình',
      'mp.tts.unsupported': 'Thiết bị không hỗ trợ đọc to.',
      'mp.tts.no_voice': 'Không có giọng đọc tiếng Việt trên thiết bị — dùng giọng mặc định.',
      'mp.tts.intro': 'Lộ trình {strategy} từ {from} đến {to}: {km}, khoảng {eta} đi {mode}.',
      'mp.tts.levels': 'Có sóng {likely}, không chắc chắn {uncertain}, mất sóng {lost}.',
      'mp.tts.dz': 'Vùng mất sóng đầu tiên bắt đầu sau {x}, dài {y}. Hãy check-in Buddy trước khi vào vùng này.',
      'mp.tts.nodz': 'Không có vùng mất sóng dự kiến.', 'mp.tts.via': 'Đi qua {list}.',
      'mp.tts.unknown': '{km} chưa có dữ liệu sóng.', 'mp.tts.online': 'trực tuyến',
      'mp.tts.end': 'Trường hợp khẩn cấp, hãy gọi 115.',
      'mp.pos.sim': 'mô phỏng', 'mp.pos.gps': 'GPS', 'mp.pos.near': 'gần {name}', 'mp.pos.change': 'Đổi',
      'mp.pos.from': 'Tính từ', 'mp.pos.none': 'Chưa có vị trí — bật GPS hoặc chọn vị trí mô phỏng.',
      'mp.pos.far': 'Bạn đang cách tuyến thí điểm gần nhất {d} — lớp sóng chỉ có trên 3 tuyến. Dùng vị trí mô phỏng để thử?',
      'mp.pos.far_btn': 'Chọn vị trí mô phỏng', 'mp.pos.set': 'Vị trí mô phỏng: {name}',
      'mp.gps.unsupported': 'Thiết bị không hỗ trợ định vị — hãy chọn vị trí mô phỏng.',
      'mp.gps.error': 'Không lấy được GPS. Bạn có thể chọn vị trí mô phỏng.', 'mp.gps.ok': 'Đã cập nhật vị trí GPS (±{m} m).',
      'mp.gps.cached': 'Chưa bắt được vị trí mới — đang dùng vị trí GPS đã lưu từ {ago} (±{m} m).',
      'mp.gps.denied': 'Trang chưa được phép dùng vị trí. Hãy cho phép trong cài đặt trình duyệt, hoặc chọn vị trí mô phỏng.',
      'mp.sim.title': 'Chọn vị trí mô phỏng',
      'mp.sim.sub': 'Dùng khi demo hoặc khi GPS chưa bắt được. Mẹo: nhấn giữ (hoặc chuột phải) trên bản đồ để đặt vị trí bất kỳ.',
      'mp.sim.gps': 'Dùng GPS thật', 'mp.sim.current': 'Đang dùng',
      'mp.ctx.point': 'Điểm trên bản đồ', 'mp.ctx.off': 'Cách tuyến {d}',
      'mp.ctx.set_pos': 'Đặt vị trí mô phỏng tại đây', 'mp.ctx.route_here': 'Chỉ đường đến đây', 'mp.ctx.from_here': 'Xuất phát từ đây',
      'mp.ctx.propose': 'Đề xuất điểm y tế mới',
      'mp.node.to': 'Đến đây', 'mp.node.from': 'Đi từ đây',
      'mp.kind.town': 'Thị trấn · thành phố', 'mp.kind.junction': 'Ngã ba', 'mp.kind.pass': 'Đèo · dốc', 'mp.kind.trailhead': 'Điểm bắt đầu trek',
      'mp.kind.village': 'Thôn · bản', 'mp.kind.viewpoint': 'Điểm ngắm cảnh', 'mp.kind.poi': 'Điểm quan tâm',
      'mp.type.benh_vien': 'Bệnh viện · TTYT', 'mp.type.phong_kham': 'Phòng khám', 'mp.type.tram_y_te': 'Trạm y tế xã', 'mp.type.nha_thuoc': 'Nhà thuốc',
      'mp.type.lodging': 'Lưu trú', 'mp.type.repair': 'Sửa xe', 'mp.type.fuel': 'Cây xăng', 'mp.type.rental': 'Thuê xe',
      'mp.med.all': 'Cơ sở khám chữa', 'mp.med.trauma_only': 'Xử lý chấn thương', 'mp.med.nearest': 'Gần nhất',
      'mp.med.night': 'Trực đêm', 'mp.med.trauma': 'Xử lý chấn thương chảy máu',
      'mp.med.verified': 'Đã xác minh {date} · {ago}', 'mp.med.days_ago': '{n} ngày trước', 'mp.med.today': 'hôm nay', 'mp.med.km_air': 'km chim bay',
      'mp.med.stale': 'Cần xác minh lại — lần cuối {date} ({n} ngày trước)',
      'mp.med.road': '≈ {eta} đi {mode} · {air} chim bay', 'mp.med.air': 'đường chim bay', 'mp.med.km_road': 'km đường đi',
      'mp.med.offroute': 'gồm {d} ngoài tuyến',
      'mp.med.noroad': 'Không có đường nối trong gói dữ liệu — khoảng cách tính theo đường chim bay.',
      'mp.med.far': 'Bạn đang cách tuyến {d} — thứ tự và khoảng cách tính theo đường chim bay.',
      'mp.med.recommended': 'Đề xuất', 'mp.med.closed_now': 'Ngoài giờ mở cửa',
      'mp.med.directions': 'Chỉ đường', 'mp.med.report': 'Báo sai',
      'mp.med.order_note': 'Xếp theo quãng đường đi thực tế trên gói dữ liệu (không có đường thì theo đường chim bay) — không bao giờ theo quan hệ đối tác hay tài trợ. “Đề xuất” ưu tiên cơ sở đang mở cửa, xử lý được chấn thương và mới xác minh khi chỉ xa hơn tối đa 15%.',
      'mp.care.picked': 'Đã chọn {name} ({why}) — chỉ xa hơn {d} so với cơ sở gần nhất, {near}.',
      'mp.care.why_open': 'đang mở cửa', 'mp.care.why_24': 'trực 24/7', 'mp.care.why_trauma': 'xử lý chấn thương', 'mp.care.why_fresh': 'mới xác minh',
      'mp.med.empty': 'Không có cơ sở phù hợp bộ lọc.', 'mp.med.filter_aria': 'Lọc loại cơ sở y tế',
      'mp.rep.title': 'Báo sai thông tin', 'mp.rep.what': 'Thông tin nào chưa đúng?',
      'mp.rep.phone': 'Số điện thoại', 'mp.rep.hours': 'Giờ mở cửa', 'mp.rep.location': 'Vị trí', 'mp.rep.closed': 'Đã đóng cửa',
      'mp.rep.capability': 'Trực đêm / chấn thương', 'mp.rep.other': 'Khác',
      'mp.rep.note': 'Ghi chú', 'mp.rep.note_ph': 'Ví dụ: số điện thoại mới, giờ mở cửa thực tế…',
      'mp.rep.send': 'Gửi báo cáo', 'mp.rep.sent': 'Đã gửi — đội ngũ sẽ xác minh lại.', 'mp.rep.queued': 'Đã xếp hàng — tự gửi khi có sóng.',
      'mp.rep.pick': 'Chọn ít nhất một mục.',
      'mp.new.title': 'Đề xuất điểm y tế mới', 'mp.new.sub': 'Đề xuất chờ đội ngũ gọi xác minh trước khi xuất hiện trong gói dữ liệu.',
      'mp.new.name': 'Tên cơ sở', 'mp.new.type': 'Loại cơ sở', 'mp.new.coords': 'Toạ độ', 'mp.new.need_name': 'Nhập tên cơ sở.',
      'mp.new.send': 'Gửi đề xuất',
      'mp.stops.along_title': 'Dọc lộ trình {from} → {to}', 'mp.stops.near_title': 'Gần vị trí của bạn (≤ {km})',
      'mp.stops.hint': 'Tính lộ trình ở thẻ Lộ trình để xem điểm dừng dọc đường (≤ 3 km).',
      'mp.stops.partner': 'Đối tác',
      'mp.stops.partner_note': 'Nhãn “Đối tác” chỉ dành cho dịch vụ phi y tế (lưu trú, sửa xe, xăng, thuê xe) và không ảnh hưởng thứ tự cơ sở y tế.',
      'mp.stops.empty': 'Không có điểm dừng trong phạm vi.',
      'mp.pk.eyebrow': 'Gói dữ liệu hành lang tuyến',
      'mp.pk.src.bundled': 'Gói cài kèm · dùng được offline', 'mp.pk.src.downloaded': 'Đã tải về máy · dùng được offline', 'mp.pk.src.server': 'Bản trên máy chủ · chưa lưu offline',
      'mp.pk.version': 'Phiên bản', 'mp.pk.published': 'Phát hành', 'mp.pk.size': 'Dung lượng', 'mp.pk.accuracy': 'Độ chính xác',
      'mp.pk.download': 'Tải gói hành lang tuyến', 'mp.pk.update': 'Cập nhật bản mới', 'mp.pk.redownload': 'Tải lại bản mới nhất',
      'mp.pk.offline': 'Cần mạng để tải gói. Gói đang có vẫn dùng được hoàn toàn offline.',
      'mp.pk.done': 'Đã tải gói {route} · {carrier} ({size}) — dùng được offline.', 'mp.pk.fail': 'Không tải được gói. Thử lại khi có mạng ổn định.',
      'mp.pk.by_carrier': 'Độ chính xác lớp sóng theo nhà mạng',
      'mp.pk.by_carrier_sub': 'Tỉ lệ khớp với {n} điểm đo giữ lại, không dùng để huấn luyện mô hình.',
      'mp.pk.model': 'Mô hình {m} · lớp sóng là dữ liệu minh hoạ',
      'mp.pk.routes': 'Các tuyến · {carrier}', 'mp.pk.st.update': 'Có bản mới', 'mp.pk.remove': 'Xoá gói đã tải', 'mp.pk.remove_q': 'Xoá gói {route} · {carrier}?',
      'mp.pk.remove_msg': 'Khi offline, ứng dụng quay về gói cài kèm cho tuyến này — vẫn dùng được hoàn toàn offline.',
      'mp.pk.removed': 'Đã xoá gói. Đang dùng gói cài kèm.', 'mp.pk.stored': 'Gói đã tải trên máy',
      'mp.pk.removed_online': 'Đã xoá gói. Đang dùng bản trên máy chủ (chưa lưu) — tải lại nếu cần dùng offline.',
      'mp.pk.none_stored': 'Chưa tải gói nào về máy này.',
      'mp.pk.storage': 'Bộ nhớ trình duyệt: {used} / {quota}',
      'mp.pk.logs': 'Đóng góp log sóng ẩn danh',
      'mp.pk.logs_text': 'Khi bật, ứng dụng gửi mức sóng (RSRP) kèm toạ độ, không kèm danh tính, để cải thiện lớp sóng cho cộng đồng. Mặc định tắt, tắt lại bất cứ lúc nào.',
      'mp.pk.logs_on': 'Đã bật đóng góp log sóng. Cảm ơn bạn!', 'mp.pk.logs_off': 'Đã tắt đóng góp log sóng.',
      'mp.pk.tech': 'Chi tiết kỹ thuật', 'mp.pk.tech_sub': 'Phiên bản, độ chính xác lớp sóng, gói đã lưu, bộ nhớ',
      'mp.pk.lead': 'Lộ trình, lớp sóng và cơ sở y tế của tuyến dùng được hoàn toàn offline.',
      'mp.pk.lead_server': 'Tải về máy để dùng bản này khi mất sóng: lộ trình, lớp sóng và cơ sở y tế của tuyến.',
      'mp.bm.title': 'Nền bản đồ offline',
      'mp.bm.sub': 'Đường, sông suối và địa danh quanh tuyến — vẫn xem được bản đồ khi mất sóng.',
      'mp.bm.st.done': 'Đã tải · {size} · dữ liệu {date}', 'mp.bm.st.done_nodate': 'Đã tải · {size}',
      'mp.bm.st.none': 'Chưa tải', 'mp.bm.st.none_size': 'Chưa tải · khoảng {size}', 'mp.bm.st.na': 'Chưa có dữ liệu cho tuyến này',
      'mp.bm.st.unsupported': 'Trình duyệt này không lưu được nền offline',
      'mp.bm.download': 'Tải nền offline · {route}', 'mp.bm.remove': 'Xoá nền offline · {route}',
      'mp.bm.remove_q': 'Xoá nền bản đồ offline {route}?',
      'mp.bm.remove_msg': 'Khi mất sóng, bản đồ chỉ còn các ô ảnh nền đã xem trước đó. Có thể tải lại bất cứ lúc nào khi có mạng.',
      'mp.bm.attr': 'Dữ liệu bản đồ © OpenStreetMap contributors (ODbL).',
      'mp.rt.title': 'Chọn tuyến', 'mp.rt.sub': 'Bản đồ, lớp sóng và cơ sở y tế của cả 3 tuyến thử nghiệm đều có sẵn offline.',
      'mp.rt.meta': '{region} · {km} · {n} cơ sở y tế đã xác minh', 'mp.rt.changed': 'Đã chọn {name}',
      'mp.sum.idle_title': 'Lộ trình an toàn theo sóng {carrier}', 'mp.sum.idle_text': 'Chọn điểm đến, hoặc nhấn giữ trên bản đồ.',
      'mp.sum.lost': '{km} mất sóng', 'mp.sum.no_lost': 'không mất sóng',
      'mp.zone.tip': 'Vùng mất sóng · km {a} – {b} ({len})',
      'mp.far.later': 'Để sau', 'mp.error': 'Không tải được bản đồ. Các tính năng khẩn cấp vẫn dùng được.'
    },
    en: {
      'mp.map_aria': 'Route map with signal layer and medical facilities',
      'mp.panel_aria': 'Route and information panel',
      'mp.panel.grip': 'Drag or tap to resize the panel',
      'mp.chip.route': 'Route', 'mp.chip.route_aria': 'Selected route: {name}. Tap to change',
      'mp.layers.aria': 'Map layers', 'mp.layers.signal': 'Signal', 'mp.layers.med': 'Medical', 'mp.layers.svc': 'Services',
      'mp.layers.btn': 'Map layers', 'mp.layers.vbase': 'Offline basemap',
      'mp.layers.signal_sub': 'Coverage along the routes', 'mp.layers.med_sub': 'Verified medical facilities', 'mp.layers.svc_sub': 'Lodging, fuel, repair, rental',
      'mp.layers.vbase_none': 'Not downloaded — get it in Data packs', 'mp.layers.vbase_auto': 'Turns on when the basemap is unavailable',
      'mp.layers.vbase_on': 'Showing', 'mp.layers.vbase_off': 'Turned off — tap to turn on again',
      'mp.layers.vbase_away': 'Outside the downloaded area — only around downloaded routes',
      'mp.layers.vbase_temp': 'Shown for now because the basemap images are blocked — download it in Data packs for use without signal',
      'mp.fab.locate': 'Locate me (GPS)', 'mp.fab.sim': 'Simulated position', 'mp.fab.fit': 'Show whole route',
      'mp.zoom_in': 'Zoom in', 'mp.zoom_out': 'Zoom out',
      'mp.legend.likely': 'Signal', 'mp.legend.uncertain': 'Uncertain', 'mp.legend.lost': 'No signal', 'mp.legend.unknown': 'No signal data',
      'mp.legend.btn': 'Signal legend', 'mp.key.title': 'Map key', 'mp.key.stale': 'Orange ring: needs re-verification', 'mp.key.zone': 'Start of a dead zone',
      'mp.demo.title': 'Demo mode', 'mp.demo.sub': 'Simulated position for demos',
      'mp.demo.text': 'For demos or while GPS has no fix: set a simulated position on a route. Tip: long-press (or right-click) the map to drop a position anywhere.',
      'mp.tab.route': 'Route', 'mp.tab.med': 'Nearest care', 'mp.tab.stops': 'Stops', 'mp.tab.packs': 'Data packs',
      'mp.plan.from': 'From', 'mp.plan.to': 'To', 'mp.plan.to_ph': 'Search destination…',
      'mp.plan.me_sim': 'Simulated position', 'mp.plan.me_gps': 'GPS position', 'mp.plan.me_none': 'No position yet',
      'mp.plan.me': 'My location', 'mp.plan.from_ph': 'Choose a start point…', 'mp.plan.from_clear': 'Clear start point',
      'mp.plan.swap': 'Swap start and destination', 'mp.plan.clear': 'Clear destination',
      'mp.plan.mode': 'Travel mode', 'mp.plan.strategy': 'Routing strategy',
      'mp.mode.motorbike': 'Motorbike', 'mp.mode.hiking': 'Hiking',
      'mp.strategy.shortest': 'Shortest', 'mp.strategy.signal': 'Signal first',
      'mp.plan.nearest_fac': 'Nearest medical facility',
      'mp.combo.facs': 'Verified medical facilities', 'mp.combo.nodes': 'Places on the route', 'mp.combo.none': 'No match for “{q}”',
      'mp.combo.svcs': 'Services along the routes', 'mp.combo.here': 'Location',
      'mp.combo.me_gps': 'GPS · ±{m} m · {ago}', 'mp.combo.me_none': 'Tap to turn on location', 'mp.combo.me_denied': 'The browser blocks location',
      'mp.combo.me_na': 'This device gives no location',
      'mp.combo.pick': 'Pick on the map', 'mp.combo.pick_meta': 'Tap a point on the map',
      'mp.combo.online': 'Online · OpenStreetMap', 'mp.combo.go': 'Search “{q}” across Vietnam', 'mp.combo.go_meta': 'Press Enter or pick this row',
      'mp.combo.consent': 'Online search sends your position and destination to OpenStreetMap services (Nominatim/OSRM) — only when you search or route beyond the offline data.',
      'mp.combo.consent_ok': 'Agree and search', 'mp.combo.loading': 'Searching OpenStreetMap…',
      'mp.combo.online_none': 'OpenStreetMap has no result for “{q}”.', 'mp.combo.online_err': 'Online search failed ({why}) — pick to try again',
      'mp.combo.offline_hint': 'No offline result. With a connection you can find any place in Vietnam.',
      'mp.combo.attr': 'Search results © OpenStreetMap contributors · Nominatim',
      'mp.err.timeout': 'timed out', 'mp.err.rate': 'the service is busy', 'mp.err.offline': 'no connection', 'mp.err.http': 'server error',
      'mp.err.parse': 'invalid response', 'mp.err.no_route': 'no road connects them', 'mp.err.unsupported': 'not supported by this browser', 'mp.err.consent': 'not agreed yet',
      'mp.pick.hint': 'Tap the map to choose the start point', 'mp.pick.cancel': 'Cancel', 'mp.pick.done': 'Start point set on the map.',
      'mp.geo.denied': 'The browser blocks your location — choose a start point in “From” (search or pick on the map).',
      'mp.geo.prompt': 'Turn on location to route from where you are.', 'mp.geo.enable': 'Turn on location',
      'mp.geo.unsupported': 'No location available here (needs https) — choose a start point by hand.',
      'mp.geo.kept': 'Your real location is {d} from the pilot routes — the demo uses a simulated position.',
      'mp.on.consent_title': 'Route online?',
      'mp.on.consent_text': 'This trip is outside the 3 pilot routes. Online routing sends your position and destination to an OpenStreetMap service (OSRM).',
      'mp.on.consent_ok': 'Agree and route', 'mp.on.loading': 'Finding an online route…',
      'mp.on.err_title': 'No online route yet', 'mp.on.err_text': 'Reason: {why}. Try again in a few seconds.', 'mp.on.retry': 'Try again',
      'mp.on.net_title': 'A connection is needed to route beyond the 3 pilot routes',
      'mp.on.net_text': 'Offline, NomadCare only routes on the data packs of the 3 pilot routes. {to} is about {air} from {from} in a straight line.',
      'mp.on.fallback': 'Offline estimate: the stretch off the route is a straight line.',
      'mp.on.hint_net': 'With a connection, NomadCare finds the real road here through OpenStreetMap.',
      'mp.on.source': 'Route: OSRM (FOSSGIS) · © OpenStreetMap contributors',
      'mp.on.unknown_note': 'Outside the 3 pilot routes there is no signal data: those stretches are grey, with no reminder there.',
      'mp.on.single': 'An online route has a single option — the strategy comparison exists only on the 3 pilot routes.',
      'mp.on.sum_loading': 'Finding an online route…', 'mp.on.sum_consent': 'Agree to route online',
      'mp.on.sum_net': 'A connection is needed', 'mp.on.sum_err': 'No online route yet',
      'mp.res.empty_title': 'Pick a destination',
      'mp.res.empty_text': 'On the 3 pilot routes, the route is worked out on this device (no connection needed) and coloured by {carrier} coverage. With a connection, anywhere in Vietnam.',
      'mp.res.need_from': 'Choose a start point', 'mp.res.need_from_text': 'Your location is not known yet — choose a start point in “From”.',
      'mp.res.unknown': 'No signal data', 'mp.res.more': 'Show more', 'mp.res.more_sub': 'Strategy comparison, stretches by signal, stops',
      'mp.res.more_sub_on': 'Stretches by signal, stops',
      'mp.trip.start': 'Start trip', 'mp.trip.stop': 'On the way · End', 'mp.trip.share': 'Send location',
      'mp.trip.na': 'Dead-zone reminders are not available in this build.',
      'mp.trip.hint': 'Start trip: a reminder ~{min} min before each dead zone ({mode}), no continuous GPS tracking.',
      'mp.trip.other': 'A trip {from} → {to} is on — Start trip replaces it.',
      'mp.dz.none_known': 'No known dead zone', 'mp.dz.none_known_text': 'Stretches without signal data (grey) may still have no signal.',
      'mp.res.none_title': 'No route found',
      'mp.res.none_text': 'The two points are not on the same road network in the data packs. Pick two points on the same route.',
      'mp.res.none_text_net': 'The two points are on different pilot routes. With a connection NomadCare finds a route online; offline, pick two points on the same route.',
      'mp.combo.live_n': '{n} online results from OpenStreetMap',
      'mp.pos.far_real': 'You are {d} from the nearest pilot route — signal data exists only on the 3 routes; other roads are grey (no signal data).',
      'mp.res.via': 'via {list}', 'mp.res.speed': '{mode} · {v} km/h',
      'mp.res.same': 'The shortest route is also the best-covered one on {carrier}.',
      'mp.res.off_end': 'The facility is {d} off the main road — the last stretch is on a side road and included in the distance.',
      'mp.res.off_end_pt': 'The destination is {d} off the main road — the off-route last stretch is included in the distance.',
      'mp.res.off_start': 'You are {d} from the route — the stretch to reach it (no signal data) is included in the distance.',
      'mp.res.off_start_pt': 'The start is {d} from the route — the stretch to reach it (no signal data) is included in the distance.',
      'mp.res.approach': 'incl. {d} off the route',
      'mp.far.title_start': 'You are {d} from the nearest route',
      'mp.far.title_end': 'The destination is {d} from the nearest route',
      'mp.far.text': 'NomadCare routes only on the road network of the pilot routes in the offline data packs, so it cannot estimate the distance, time or dead zones of this trip. {to} is about {air} from {from} in a straight line.',
      'mp.far.sum': '{d} from the route · no route estimate',
      'mp.far.tts': 'No route estimate: {from} is {d} from the nearest route. {to} is about {air} away in a straight line.',
      'mp.far.you': 'you',
      'mp.res.levels': 'Signal along the route',
      'mp.dz.title': 'Signal lost in {x} (~{t}) · {y} long',
      'mp.dz.title_now': 'You are inside a dead zone · {y} to go',
      'mp.dz.zones': '{n} dead zones on this route · longest {max}',
      'mp.dz.soon': 'Coming up — send your location now',
      'mp.dz.none_title': 'No expected dead zone',
      'mp.dz.none_text': 'According to the {carrier} layer, the whole route likely has signal or is uncertain.',
      'mp.dz.show': 'Show on map',
      'mp.cmp.title': 'Strategy comparison', 'mp.cmp.sub': 'Same start and destination · dead-zone km weigh ×2.5, uncertain ×1.5.',
      'mp.cmp.lost': '{km} no signal', 'mp.cmp.no_lost': 'No dead zone',
      'mp.cmp.verdict': 'Signal-first adds {dk} (~{dt}) but spends {dl} less in dead zones ({p}%).',
      'mp.cmp.verdict_free': 'Signal-first spends {dl} less in dead zones at no extra distance.',
      'mp.cmp.in_use': 'In use', 'mp.cmp.alt_tip': '{name} route: {km} · {lost} without signal — tap to use',
      'mp.parts.title': 'Stretches by signal level', 'mp.parts.count': '{n} stretches', 'mp.parts.km': 'km {a} – {b}',
      'mp.parts.more': 'Show all {n} stretches', 'mp.parts.less': 'Show less',
      'mp.along.title': 'Along the route (≤ {km})', 'mp.along.all': 'All', 'mp.along.at': 'km {km}', 'mp.along.off': '{d} off the road',
      'mp.along.none': 'No facility or service within {km} of the route.',
      'mp.act.speak': 'Read directions', 'mp.act.stop': 'Stop reading', 'mp.act.clear': 'Clear route',
      'mp.tts.unsupported': "This device can't read aloud.",
      'mp.tts.no_voice': 'No matching voice on this device — using the default voice.',
      'mp.tts.intro': '{strategy} route from {from} to {to}: {km}, about {eta} by {mode}.',
      'mp.tts.levels': 'Likely signal {likely}, uncertain {uncertain}, no signal {lost}.',
      'mp.tts.dz': 'The first dead zone starts in {x} and is {y} long. Check in with your Buddy before entering it.',
      'mp.tts.nodz': 'No dead zone expected.', 'mp.tts.via': 'Passing {list}.',
      'mp.tts.unknown': '{km} without signal data.', 'mp.tts.online': 'Online',
      'mp.tts.end': 'In an emergency, call 115.',
      'mp.pos.sim': 'simulated', 'mp.pos.gps': 'GPS', 'mp.pos.near': 'near {name}', 'mp.pos.change': 'Change',
      'mp.pos.from': 'From', 'mp.pos.none': 'No position yet — use GPS or pick a simulated position.',
      'mp.pos.far': 'You are {d} from the nearest pilot route — signal data exists only on the 3 routes. Try a simulated position?',
      'mp.pos.far_btn': 'Pick a simulated position', 'mp.pos.set': 'Simulated position: {name}',
      'mp.gps.unsupported': "This device can't provide a location — pick a simulated position.",
      'mp.gps.error': "Couldn't get a GPS fix. You can pick a simulated position.", 'mp.gps.ok': 'GPS position updated (±{m} m).',
      'mp.gps.cached': 'No fresh fix yet — using the saved GPS position from {ago} (±{m} m).',
      'mp.gps.denied': 'This site may not use your location. Allow it in the browser settings, or pick a simulated position.',
      'mp.sim.title': 'Pick a simulated position',
      'mp.sim.sub': 'For demos or while GPS has no fix. Tip: long-press (or right-click) the map to drop a position anywhere.',
      'mp.sim.gps': 'Use real GPS', 'mp.sim.current': 'In use',
      'mp.ctx.point': 'Point on the map', 'mp.ctx.off': '{d} from the route',
      'mp.ctx.set_pos': 'Set simulated position here', 'mp.ctx.route_here': 'Directions to here', 'mp.ctx.from_here': 'Start from here',
      'mp.ctx.propose': 'Propose a new medical point',
      'mp.node.to': 'Go here', 'mp.node.from': 'Start here',
      'mp.kind.town': 'Town · city', 'mp.kind.junction': 'Junction', 'mp.kind.pass': 'Mountain pass', 'mp.kind.trailhead': 'Trailhead',
      'mp.kind.village': 'Village · hamlet', 'mp.kind.viewpoint': 'Viewpoint', 'mp.kind.poi': 'Point of interest',
      'mp.type.benh_vien': 'Hospital · medical centre', 'mp.type.phong_kham': 'Clinic', 'mp.type.tram_y_te': 'Commune health station', 'mp.type.nha_thuoc': 'Pharmacy',
      'mp.type.lodging': 'Lodging', 'mp.type.repair': 'Motorbike repair', 'mp.type.fuel': 'Fuel', 'mp.type.rental': 'Rental',
      'mp.med.all': 'Care facilities', 'mp.med.trauma_only': 'Trauma care', 'mp.med.nearest': 'Nearest',
      'mp.med.night': 'Night shift', 'mp.med.trauma': 'Treats bleeding injuries',
      'mp.med.verified': 'Verified {date} · {ago}', 'mp.med.days_ago': '{n} days ago', 'mp.med.today': 'today', 'mp.med.km_air': 'km straight',
      'mp.med.stale': 'Needs re-verification — last checked {date} ({n} days ago)',
      'mp.med.road': '≈ {eta} by {mode} · {air} straight line', 'mp.med.air': 'straight line', 'mp.med.km_road': 'km by road',
      'mp.med.offroute': 'incl. {d} off the route',
      'mp.med.noroad': 'No road link in the data packs — the distance is a straight line.',
      'mp.med.far': 'You are {d} from the route — order and distances are straight-line.',
      'mp.med.recommended': 'Recommended', 'mp.med.closed_now': 'Closed now',
      'mp.med.directions': 'Directions', 'mp.med.report': 'Report',
      'mp.med.order_note': 'Sorted by the actual road distance in the data packs (straight line when there is no road) — never by partnership or sponsorship. “Recommended” prefers a facility that is open now, treats injuries and was recently verified when it is at most 15% farther.',
      'mp.care.picked': 'Picked {name} ({why}) — only {d} farther than the nearest, {near}.',
      'mp.care.why_open': 'open now', 'mp.care.why_24': 'open 24/7', 'mp.care.why_trauma': 'treats injuries', 'mp.care.why_fresh': 'recently verified',
      'mp.med.empty': 'No facility matches this filter.', 'mp.med.filter_aria': 'Filter facility type',
      'mp.rep.title': 'Report incorrect information', 'mp.rep.what': 'What is wrong?',
      'mp.rep.phone': 'Phone number', 'mp.rep.hours': 'Opening hours', 'mp.rep.location': 'Location', 'mp.rep.closed': 'Closed down',
      'mp.rep.capability': 'Night shift / trauma', 'mp.rep.other': 'Other',
      'mp.rep.note': 'Note', 'mp.rep.note_ph': 'E.g. the new phone number, actual opening hours…',
      'mp.rep.send': 'Send report', 'mp.rep.sent': 'Sent — the team will re-verify.', 'mp.rep.queued': 'Queued — sent at the first signal.',
      'mp.rep.pick': 'Pick at least one item.',
      'mp.new.title': 'Propose a new medical point', 'mp.new.sub': 'The team phones to verify a proposal before it appears in a data pack.',
      'mp.new.name': 'Facility name', 'mp.new.type': 'Facility type', 'mp.new.coords': 'Coordinates', 'mp.new.need_name': 'Enter the facility name.',
      'mp.new.send': 'Send proposal',
      'mp.stops.along_title': 'Along {from} → {to}', 'mp.stops.near_title': 'Near you (≤ {km})',
      'mp.stops.hint': 'Compute a route in the Route tab to see stops along the way (≤ 3 km).',
      'mp.stops.partner': 'Partner',
      'mp.stops.partner_note': 'The “Partner” label is only for non-medical services (lodging, repair, fuel, rental) and never affects the order of medical facilities.',
      'mp.stops.empty': 'No stops within range.',
      'mp.pk.eyebrow': 'Route corridor data pack',
      'mp.pk.src.bundled': 'Bundled pack · works offline', 'mp.pk.src.downloaded': 'Downloaded · works offline', 'mp.pk.src.server': 'Server copy · not saved offline',
      'mp.pk.version': 'Version', 'mp.pk.published': 'Published', 'mp.pk.size': 'Size', 'mp.pk.accuracy': 'Accuracy',
      'mp.pk.download': 'Download corridor pack', 'mp.pk.update': 'Get the new version', 'mp.pk.redownload': 'Download latest again',
      'mp.pk.offline': 'A connection is needed to download. The pack you have keeps working fully offline.',
      'mp.pk.done': 'Downloaded {route} · {carrier} ({size}) — works offline.', 'mp.pk.fail': "Couldn't download the pack. Try again on a stable connection.",
      'mp.pk.by_carrier': 'Coverage accuracy by carrier',
      'mp.pk.by_carrier_sub': 'Agreement with {n} held-out measurements not used to train the model.',
      'mp.pk.model': 'Model {m} · the signal layer is illustrative data',
      'mp.pk.routes': 'Routes · {carrier}', 'mp.pk.st.update': 'New version available', 'mp.pk.remove': 'Remove downloaded pack', 'mp.pk.remove_q': 'Remove the {route} · {carrier} pack?',
      'mp.pk.remove_msg': 'Offline, the app falls back to the bundled pack for this route — still fully usable offline.',
      'mp.pk.removed': 'Pack removed. Using the bundled pack.', 'mp.pk.stored': 'Packs stored on this device',
      'mp.pk.removed_online': 'Pack removed. Using the server copy (not saved) — download again if you need it offline.',
      'mp.pk.none_stored': 'No pack downloaded to this device yet.',
      'mp.pk.storage': 'Browser storage: {used} / {quota}',
      'mp.pk.logs': 'Contribute anonymous signal logs',
      'mp.pk.logs_text': 'When on, the app sends signal strength (RSRP) with coordinates and no identity, to improve the community coverage layer. Off by default; turn it off any time.',
      'mp.pk.logs_on': 'Signal log contribution is on. Thank you!', 'mp.pk.logs_off': 'Signal log contribution is off.',
      'mp.pk.tech': 'Technical details', 'mp.pk.tech_sub': 'Versions, coverage accuracy, stored packs, storage',
      'mp.pk.lead': "The route's roads, signal layer and medical facilities work fully offline.",
      'mp.pk.lead_server': "Download it to use this copy without signal: the route's roads, signal layer and medical facilities.",
      'mp.bm.title': 'Offline basemap',
      'mp.bm.sub': 'Roads, rivers and place names around the route — the map stays readable without signal.',
      'mp.bm.st.done': 'Downloaded · {size} · data {date}', 'mp.bm.st.done_nodate': 'Downloaded · {size}',
      'mp.bm.st.none': 'Not downloaded', 'mp.bm.st.none_size': 'Not downloaded · about {size}', 'mp.bm.st.na': 'Not available for this route yet',
      'mp.bm.st.unsupported': "This browser can't store the offline basemap",
      'mp.bm.download': 'Download offline basemap · {route}', 'mp.bm.remove': 'Remove offline basemap · {route}',
      'mp.bm.remove_q': 'Remove the {route} offline basemap?',
      'mp.bm.remove_msg': 'Without signal, the map then only shows basemap tiles you viewed before. You can download it again any time online.',
      'mp.bm.attr': 'Map data © OpenStreetMap contributors (ODbL).',
      'mp.rt.title': 'Choose a route', 'mp.rt.sub': 'Maps, signal layers and medical facilities for all 3 pilot routes are available offline.',
      'mp.rt.meta': '{region} · {km} · {n} verified medical facilities', 'mp.rt.changed': 'Selected {name}',
      'mp.sum.idle_title': 'Signal-aware routes · {carrier}', 'mp.sum.idle_text': 'Pick a destination or long-press the map.',
      'mp.sum.lost': '{km} no signal', 'mp.sum.no_lost': 'no dead zone',
      'mp.zone.tip': 'Dead zone · km {a} – {b} ({len})',
      'mp.far.later': 'Later', 'mp.error': "The map couldn't load. Emergency features still work."
    }
  });

  if (NC.icons && NC.icons.has && NC.icons.add && !NC.icons.has('arrow-up-down')) {
    NC.icons.add('arrow-up-down', '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>');
  }

  /* ================================================================== constants & state */
  var FAR_KM = 30;           // GPS farther than this from every edge → offer a simulated position; offline routing limit
  var SNAP_KM = 5;           // both ends this close to the pilot graph → offline A*; otherwise online (OSRM) when possible
  var PLAN_MAX_PTS = 600;    // TripPlan geometry budget (C2)
  var BUFFER_KM = 3;         // "stops along the route" corridor
  var NEAR_KM = 30;          // "near you" radius when no route is computed
  var KV_LAST = 'map.last_route';
  var KV_UI = 'map.ui';
  var FAC_TYPES = ['benh_vien', 'phong_kham', 'tram_y_te', 'nha_thuoc'];
  var CARE_TYPES = ['benh_vien', 'phong_kham', 'tram_y_te'];
  var STOP_GROUPS = ['nha_thuoc', 'lodging', 'repair', 'fuel', 'rental'];
  var TONE = { benh_vien: 'danger', phong_kham: 'info', tram_y_te: 'primary', nha_thuoc: 'success', lodging: 'accent', repair: 'neutral', fuel: 'warning', rental: 'info' };
  var KIND_ICON = { town: 'map-pin', junction: 'route', pass: 'mountain', trailhead: 'footprints', village: 'home', viewpoint: 'compass', poi: 'flag' };
  var MODE_ICON = { motorbike: 'bike', hiking: 'footprints' };
  var STRAT_ICON = { shortest: 'route', signal: 'signal' };
  var SNAPS = ['peek', 'half', 'full'];
  var FAB_OVERHANG = 22;
  /* Shared (mutated in place) auto-pan paddings for every popup: keeps popups clear of the floating controls/panel. */
  var PAD_TL = [16, 120], PAD_BR = [60, 220];
  function popOpts(o) { return Object.assign({ className: 'mp-popup', autoPanPaddingTopLeft: PAD_TL, autoPanPaddingBottomRight: PAD_BR }, o || {}); }
  /** Suggested pairs per pilot route (filtered by what the pack actually contains). */
  var PRESETS = {
    'ha-giang-loop': [['hg-meo-vac', 'hg-ha-giang'], ['hg-ha-giang', 'hg-dong-van'], ['hg-dong-van', 'hg-lung-cu']],
    'khanh-le': [['kl-da-lat', 'kl-nha-trang'], ['kl-nha-trang', 'kl-deo-top']],
    'ta-nang-phan-dung': [['tn-trailhead', 'tn-junction'], ['tn-ta-nang', 'tn-phan-dung']]
  };

  var S = {
    root: null, els: {}, map: null, lg: {}, mounted: false, shown: false,
    carrier: 'viettel', routeId: 'ha-giang-loop', mode: 'motorbike', strategy: 'shortest',
    packs: {}, graph: null, facilities: [], loading: null, gen: 0, medGen: 0, pkGen: 0,
    pos: null, from: 'me', to: null, result: null, restored: false,
    layers: { signal: true, med: true, svc: false },
    tab: 'route', snap: 'half', m: null, medType: 'all', traumaOnly: false, partsOpen: false,
    farDismissed: false, speaking: false, suppressUntil: 0,
    autoFit: false, fitting: false, lastFit: null, packsCarrier: null,
    // offline vector basemap: 'auto' (shown whenever raster tiles are unavailable) | 'on' | 'off' (session only)
    vbaseMode: 'auto', bm: null, lmenuRel: null, sheetMode: null,
    // round 2: hybrid routing / comboboxes / location
    routeGen: 0, onlineCache: [], onlineFail: [], onlineAuto: [], onlinePending: null, os: null, cb: {}, picking: null, pickRel: null, moreOpen: false,
    geoPerm: null, focusIntent: null, focusT: 0, liveMsg: '', liveT: 0
  };
  /* Bottom-sheet panel on phones in portrait; landscape phones (≤ 500px tall) and ≥ 768px get the side panel. */
  function coarse() { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }
  var mqSheet = window.matchMedia ? window.matchMedia('(max-width: 767px) and (orientation: portrait), (max-width: 767px) and (min-height: 501px)') : null;

  /* ================================================================== small helpers */
  function lang() { return NC.i18n ? NC.i18n.lang() : 'vi'; }
  function km(v) { return U.fmtKm(v); }
  function dur(m) { return U.fmtDuration(m); }
  function num(v, d) { return U.fmtNumber(v, d === undefined ? 0 : d); }
  function isSheet() { return !!(mqSheet && mqSheet.matches); }
  function shortName(s) { return String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); }
  function nodeName(n) { return n ? ((lang() === 'en' && n.name_en) ? n.name_en : n.name) : ''; }
  /* Region of a route as HTML: region_en only exists in newer seeds / packs (NOTES §4) → fall back to the Vietnamese
     region, tagged lang="vi" inside the English UI (same rule as home / onboarding / settings). */
  function regionHtml(r) {
    if (!r) return '';
    var en = lang() === 'en' && !!r.region_en && r.region_en !== r.region;
    var txt = String((en ? r.region_en : r.region) || '');
    return en || lang() !== 'en' || !txt ? esc(txt) : '<span lang="vi">' + esc(txt) + '</span>';
  }
  function routeName(id) { return NC.app.routeName ? NC.app.routeName(id) : id; }
  function carrierName(id) { return NC.app.carrierName ? NC.app.carrierName(id) : id; }
  function speedOf(mode) { return (R().SPEEDS && R().SPEEDS[mode]) || 25; }
  function etaMin(lenKm, mode) { return lenKm / speedOf(mode || S.mode) * 60; }
  function pct(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : 0; }
  function nowIso() { return new Date().toISOString(); }
  function toast(msg, o) { return NC.ui.toast(msg, o); }
  function node(id) { return S.graph && S.graph.nodes[id] ? S.graph.nodes[id] : null; }
  function seedRoutes() {
    var r = (window.NC_SEED && window.NC_SEED.routes) || [];
    return r.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }
  function routeMeta(id) {
    var g = S.graph && S.graph.routes[id];
    return g || seedRoutes().filter(function (r) { return r.id === id; })[0] || null;
  }
  function facById(id) {
    var f = S.facilities.filter(function (x) { return x.id === id; })[0];
    if (f) return f;
    return S.graph ? S.graph.facilities.filter(function (x) { return x.id === id; })[0] || null : null;
  }
  function svcById(id) { return S.graph ? S.graph.services.filter(function (x) { return x.id === id; })[0] || null : null; }
  function isFac(poi) { return FAC_TYPES.indexOf(poi && poi.type) >= 0; }
  function sheetIconTile(type, size) {
    var sz = size === 'md' ? '' : ' icon-tile--' + (size || 'sm');
    return '<span class="icon-tile' + sz + ' icon-tile--' + (TONE[type] || 'neutral') + '">' + ic(NC.mapkit ? NC.mapkit.iconFor(type) : 'map-pin') + '</span>';
  }
  function persistUi() {
    if (!NC.store) return;
    // vbase: only an explicit "on" is remembered — a remembered "off" would silently disable the offline fallback
    NC.store.set(KV_UI, { tab: S.tab, strategy: S.strategy, layers: S.layers, vbase: S.vbaseMode === 'on' ? 'on' : 'auto' }).catch(function () { });
  }

  /** Nodes of a route in travel order (edge ids are numbered along the route; node order differs by source). */
  function routeNodes(routeId) {
    var g = S.graph;
    if (!g) return [];
    var edges = Object.keys(g.edges).map(function (id) { return g.edges[id]; })
      .filter(function (e) { return e.route_id === routeId; })
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id), 'en', { numeric: true }); });
    var seen = {}, out = [];
    edges.forEach(function (e) {
      [e.from, e.to].forEach(function (id) { if (!seen[id] && g.nodes[id]) { seen[id] = 1; out.push(g.nodes[id]); } });
    });
    Object.keys(g.nodes).forEach(function (id) {
      if (!seen[id] && g.nodes[id].route_id === routeId) { seen[id] = 1; out.push(g.nodes[id]); }
    });
    return out;
  }
  function routeIdsOrdered() {
    var ids = seedRoutes().map(function (r) { return r.id; });
    if (S.graph) Object.keys(S.graph.routes).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    ids.sort(function (a, b) { return (a === S.routeId ? -1 : 0) - (b === S.routeId ? -1 : 0); });
    return ids;
  }
  function nearestNode(p, maxKm) {
    if (!S.graph || !p) return null;
    var best = null;
    Object.keys(S.graph.nodes).forEach(function (id) {
      var n = S.graph.nodes[id];
      var d = R().haversineKm(p, n);
      if (!best || d < best.d) best = { node: n, d: d };
    });
    return best && (maxKm === undefined || best.d <= maxKm) ? best : null;
  }
  function coordText(p) { return num(p.lat, 4) + ', ' + num(p.lng, 4); }
  function placeLabel(p) {
    var nn = nearestNode(p, 4);
    return nn ? t('mp.pos.near', { name: shortName(nodeName(nn.node)) }) : coordText(p);
  }

  /* ---------- endpoints ----------
   * S.from: 'me' | node id | {lat,lng[,kind:'fac'|'svc'|'point'|'place', id, label]}
   * S.to: {kind:'node'|'fac'|'svc'|'point'|'place'|'me', id?, lat?, lng?, label?}  ('place' = an online search result)
   * Both ends keep their identity (name, 'me' = live position) so swapping twice restores the original trip. */
  function fromPoint() {
    if (S.from === 'me') return S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : null;
    if (S.from && typeof S.from === 'object') return { lat: S.from.lat, lng: S.from.lng };
    return node(S.from) ? S.from : null;
  }
  function fromLatLng() {
    var p = fromPoint();
    if (!p) return null;
    if (typeof p === 'string') { var n = node(p); return { lat: n.lat, lng: n.lng }; }
    return p;
  }
  function toPoint() {
    var d = S.to;
    if (!d) return null;
    if (d.kind === 'node') return node(d.id) ? d.id : null;
    if (d.kind === 'me') return S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : null;
    return { lat: d.lat, lng: d.lng };
  }
  function toLatLng() {
    var d = S.to;
    if (!d) return null;
    if (d.kind === 'node') { var n = node(d.id); return n ? { lat: n.lat, lng: n.lng } : null; }
    if (d.kind === 'me') return S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : null;
    return { lat: d.lat, lng: d.lng };
  }
  /** True when an end is the live position (from 'me' or to {kind:'me'}). */
  function endIsMe(which) { return which === 'from' ? S.from === 'me' : !!(S.to && S.to.kind === 'me'); }
  function destFor(id) {
    if (!id) return null;
    if (node(id)) return { kind: 'node', id: id };
    var f = facById(id);
    if (f) return { kind: 'fac', id: id, lat: f.lat, lng: f.lng };
    var s = svcById(id);
    if (s) return { kind: 'svc', id: id, lat: s.lat, lng: s.lng };
    return null;
  }
  function destLabel(d) {
    if (!d) return '';
    if (d.kind === 'node') return nodeName(node(d.id));
    if (d.kind === 'me') return t('mp.plan.me');
    if (d.kind === 'fac') { var f = facById(d.id); return f ? f.name : ''; }
    if (d.kind === 'svc') { var s = svcById(d.id); return s ? s.name : ''; }
    if (d.kind === 'place') return d.label || coordText(d);
    return t('mp.ctx.point') + ' · ' + coordText(d);
  }
  function fromLabel() {
    if (S.from === 'me') return t('mp.plan.me');
    if (S.from && typeof S.from === 'object') {
      if (S.from.kind === 'fac' || S.from.kind === 'svc' || S.from.kind === 'place') return destLabel(S.from) || t('mp.ctx.point');
      return t('mp.ctx.point');
    }
    return nodeName(node(S.from));
  }
  /* Text shown in the From / To fields (empty = placeholder). */
  function fieldLabel(which) {
    if (which === 'to') return S.to ? destLabel(S.to) : '';
    if (S.from === 'me') return S.pos ? t('mp.plan.me') : '';
    if (S.from && typeof S.from === 'object' && S.from.kind !== 'fac' && S.from.kind !== 'svc' && S.from.kind !== 'place') return destLabel(S.from);
    return fromLabel();
  }
  /* A picked destination-like value → the S.from form (node id, 'me' or an object keeping its identity). */
  function asFrom(d) {
    if (!d) return null;
    if (d.kind === 'me') return 'me';
    if (d.kind === 'node') return d.id;
    return { kind: d.kind, id: d.id || null, lat: d.lat, lng: d.lng, label: d.label || null };
  }

  /* ================================================================== data: graph + facilities */
  function loadGraph() {
    var gen = ++S.gen;
    var carrier = S.carrier;
    if (!NC.data || !NC.routing) return Promise.resolve();
    var ids = seedRoutes().map(function (r) { return r.id; });
    if (!ids.length) ids = Object.keys(PRESETS);
    S.loading = Promise.all(ids.map(function (id) {
      return NC.data.getPack(id, carrier).catch(function () { return null; });
    })).then(function (packs) {
      if (gen !== S.gen) return null;
      var list = packs.filter(function (p) { return p && p.route; });
      S.packs = {};
      S.packsCarrier = carrier;
      list.forEach(function (p) { S.packs[p.route.id] = p; });
      S.graph = R().buildGraph(list);
      var center = S.pos || centerOf(S.routeId) || { lat: 16, lng: 107 };
      return NC.data.nearestFacilities(center, { limit: 2000 }).catch(function () { return S.graph.facilities; });
    }).then(function (facs) {
      if (gen !== S.gen || !S.graph) return;
      S.facilities = facs || [];
      if (S.to && S.to.kind === 'fac' && !facById(S.to.id)) S.to = null;
      if (S.from !== 'me' && typeof S.from === 'string' && !node(S.from)) S.from = 'me';
      computeRoute({ silent: true, fit: false });
      drawAll();
      renderAll();
      checkFar();
    }).catch(function (e) {
      console.warn('[map] loadGraph failed', e && e.message);
    });
    return S.loading;
  }

  function centerOf(routeId) {
    var r = routeMeta(routeId);
    if (!r || !r.bbox) return null;
    return { lat: (r.bbox[0] + r.bbox[2]) / 2, lng: (r.bbox[1] + r.bbox[3]) / 2 };
  }

  /* ================================================================== routing */
  function samePath(a, b) {
    if (!a || !b) return false;
    var ka = a.steps.map(function (s) { return s.edgeId; }).join('|');
    var kb = b.steps.map(function (s) { return s.edgeId; }).join('|');
    return ka === kb && Math.abs(a.length_km - b.length_km) < 0.05;
  }
  function routeOfPath(p) {
    var st = p && p.steps && p.steps[0];
    var e = st && S.graph.edges[st.edgeId];
    return e ? e.route_id : S.routeId;
  }
  function poisAlong(an) {
    var pois = (S.facilities.length ? S.facilities : S.graph.facilities).concat(S.graph.services);
    return R().stopsAlong(an, pois, { buffer_km: BUFFER_KM });
  }
  function viaList(an, max) {
    var ids = (an.nodeIds || []).slice(1, -1);
    var picked = ids.map(node).filter(function (n) { return n && (n.kind === 'town' || n.kind === 'junction' || n.kind === 'village'); });
    if (!picked.length) picked = ids.map(node).filter(Boolean);
    return picked.slice(0, max || 3).map(function (n) { return shortName(nodeName(n)); });
  }

  /* ---------- hybrid routing (round 2 R4) ---------- */
  function llOf(p) {
    if (!p) return null;
    if (typeof p === 'string') { var n = node(p); return n ? { lat: n.lat, lng: n.lng } : null; }
    return isFinite(p.lat) && isFinite(p.lng) ? { lat: +p.lat, lng: +p.lng } : null;
  }
  /* Distance (km) of an end from the pilot road graph (0 for a graph node). */
  function graphKm(p) {
    if (typeof p === 'string') return node(p) ? 0 : Infinity;
    var sn = S.graph && p ? R().snap(S.graph, p) : null;
    return sn ? sn.distance_km : Infinity;
  }
  function geoOnline() { return NC.geoOnline && NC.geoOnline.route ? NC.geoOnline : null; }
  function isDemo() { return !!(NC.geo && NC.geo.isDemo && NC.geo.isDemo()); }

  /* Offline A*: both strategies between a and b on the pack graph (+ straight approach legs off the network). */
  function offlineResult(a, b) {
    var paths = {};
    ['shortest', 'signal'].forEach(function (st) {
      var p = null;
      try { p = R().routeBetween(S.graph, a, b, { strategy: st }); } catch (e) { p = null; }
      if (p && p.steps && p.steps.length && p.length_km > 0.01) paths[st] = { path: p, an: R().analyze(S.graph, p), strategy: st };
    });
    var main = paths[S.strategy];
    if (!main) return { none: true };
    var other = paths[S.strategy === 'shortest' ? 'signal' : 'shortest'] || null;
    var startOff = main.path.start ? main.path.start.distance_km : 0;
    var endOff = main.path.end ? main.path.end.distance_km : 0;
    // Far from every pilot route (e.g. a judge testing from HCMC): the on-network leg is meaningless as a
    // headline, so the result explains the gap instead of claiming "3 km · no dead zone".
    var far = startOff > FAR_KM ? { side: 'start', km: startOff } : endOff > FAR_KM ? { side: 'end', km: endOff } : null;
    var approach = far ? 0 : startOff + endOff; // off-network approach legs, counted like roadTo() does for the cards
    return {
      source: 'offline', main: main, other: other, same: !other || samePath(main.path, other.path), paths: paths,
      routeId: routeOfPath(main.path), stops: poisAlong(main.an),
      startOff: startOff, endOff: endOff, far: far, approach: approach,
      total: main.an.length_km + approach
    };
  }

  function curMode() { return S.mode === 'hiking' ? 'hiking' : 'motorbike'; }
  /* Does a remembered online trip {a, b, mode, route?} stand for the requested ends? An end that is the live
     position matches within 1 km (or anywhere ≤ 500 m off the route), any other end within 20 m — so a new fix never
     re-requests a trip that is cached, on its way or failed. */
  function sameTrip(c, A, B) {
    if (!c || c.mode !== curMode()) return false;
    var meFrom = endIsMe('from'), meTo = endIsMe('to');
    var okA = R().haversineKm(c.a, A) <= (meFrom ? 1 : 0.02);
    if (!okA && meFrom && c.route) { var pr = R().progressOnLine(c.route.geometry, [A.lat, A.lng]); okA = !!(pr && pr.offset_km <= 0.5); }
    return okA && R().haversineKm(c.b, B) <= (meTo ? 1 : 0.02);
  }
  function findTrip(list, A, B) {
    for (var i = 0; i < list.length; i++) if (sameTrip(list[i], A, B)) return list[i];
    return null;
  }
  /* Cached online routes (this session + the restored last one). */
  function onlineHit(A, B) { return findTrip(S.onlineCache, A, B); }
  /* Pilot route an online route shares most dead-zone km with (else most km), for the basemap suggestion / plan. */
  function dominantRoute(an) {
    var pick = function (m) { var best = null; Object.keys(m || {}).forEach(function (k) { if (!best || m[k] > m[best]) best = k; }); return best; };
    return pick(an.lost_by_route) || pick(an.routes_km) || null;
  }
  function onlineResult(hit) {
    var memo = hit.an || (hit.an = {});
    var an = memo[S.carrier] || (memo[S.carrier] = R().overlaySignal(S.graph, hit.route.geometry));
    var main = { an: an, strategy: S.strategy, path: null };
    return {
      source: 'online', main: main, other: null, same: true, paths: {}, routeId: dominantRoute(an), stops: poisAlong(an),
      startOff: 0, endOff: 0, far: null, approach: 0, total: an.length_km,
      online: { distance_km: hit.route.distance_km, duration_min: hit.route.duration_min, profile: hit.route.profile, restored: !!hit.restored }
    };
  }
  /* One request per trip: a recompute while it is on the way (new fix, carrier, strategy) waits for the same answer.
     A failed trip shows the 'error' gate until "Thử lại" is tapped (opts.retry) or the connection comes back; the
     recompute after an answer never carries `retry`. Safety net: at most ONLINE_AUTO_MAX requests that were not a
     "Thử lại" tap per ONLINE_AUTO_WIN_MS. */
  var ONLINE_AUTO_MAX = 10, ONLINE_AUTO_WIN_MS = 5 * 60000;
  function autoBudget() {
    var now = Date.now();
    S.onlineAuto = S.onlineAuto.filter(function (t0) { return now - t0 < ONLINE_AUTO_WIN_MS; });
    return S.onlineAuto.length < ONLINE_AUTO_MAX;
  }
  function fetchOnline(A, B, gen, opts) {
    var G = geoOnline();
    var req = { a: A, b: B, mode: curMode() };
    if (!opts.retry) S.onlineAuto.push(Date.now());
    S.onlinePending = req;
    var done = function () {
      if (S.onlinePending === req) S.onlinePending = null;
      // still the trip on screen (the ends may have been re-computed meanwhile) → show the answer
      var A2 = llOf(fromPoint()), B2 = llOf(toPoint());
      if ((A2 && B2 && sameTrip(req, A2, B2)) || gen === S.routeGen) computeRoute(Object.assign({}, opts, { net: true, retry: false }));
    };
    G.route([A.lat, A.lng], [B.lat, B.lng], req.mode).then(function (rt) {
      S.onlineCache.unshift({ a: A, b: B, mode: req.mode, route: rt });
      if (S.onlineCache.length > 8) S.onlineCache.length = 8;
      done();
    }, function (e) {
      if (e && e.code === 'aborted') { if (S.onlinePending === req) S.onlinePending = null; return; }
      req.code = (e && e.code) || 'http';
      S.onlineFail.unshift(req);
      if (S.onlineFail.length > 8) S.onlineFail.length = 8;
      done();
    });
  }
  /*
   * An end farther than SNAP_KM from the pilot graph (or the ends on unconnected pilot routes). Online: cached route,
   * else the consent gate, else an OSRM request (gate 'pending' until it answers, 'error' when it failed). Offline:
   * the offline estimate within FAR_KM, else the 'net' gate. A gate keeps the offline estimate (≤ FAR_KM) as
   * `fallback` to show under it.
   */
  function onlinePlan(a, b, opts, gen) {
    var A = llOf(a), B = llOf(b);
    var hit = A && B ? onlineHit(A, B) : null;
    if (hit) return onlineResult(hit);
    var est = offlineResult(a, b);
    var fallback = est && est.main && !est.far ? est : null;
    var gate = function (kind, extra) {
      var g = Object.assign({ gate: kind, a: A, b: B, fallback: !!fallback }, extra || {});
      return fallback ? Object.assign({}, fallback, g) : g;
    };
    var G = geoOnline();
    if (!G || !G.available() || !A || !B) return fallback ? Object.assign(fallback, { netHint: !!G }) : gate('net');
    if (!G.consented()) return gate('consent');
    if (S.onlinePending && sameTrip(S.onlinePending, A, B)) return gate('pending');
    var fail = findTrip(S.onlineFail, A, B);
    if (fail && !opts.retry) return gate('error', { err: fail.code });
    if (fail) S.onlineFail.splice(S.onlineFail.indexOf(fail), 1);
    if (!opts.retry && !autoBudget()) return gate('error', { err: 'rate' });
    fetchOnline(A, B, gen, opts);
    return gate('pending');
  }

  /**
   * Route between the current endpoints (hybrid, see onlinePlan); offline both strategies, `main` = the selected one.
   * opts: {silent: don't save kv / no suggestion, fit: fit the map (default true), retry: retry a failed online route}
   */
  function computeRoute(opts) {
    opts = opts || {};
    var gen = ++S.routeGen;
    S.result = null;
    var a = fromPoint(), b = toPoint();
    if (S.graph && a && b) {
      var near = graphKm(a) <= SNAP_KM && graphKm(b) <= SNAP_KM;
      S.result = near ? offlineResult(a, b) : onlinePlan(a, b, opts, gen);
      // both ends near the pilot graph but on different (unconnected) pilot routes: online → OSRM (consent gate,
      // request, signal overlay) like any other far trip; offline the "not on one network" card stays, with a hint
      if (near && S.result && S.result.none) {
        var G = geoOnline();
        if (G && G.available()) S.result = onlinePlan(a, b, opts, gen);
        else if (G) S.result.netHint = true;
      }
    } else if (S.graph && S.to && !a) S.result = { needFrom: true };
    var r = S.result;
    if (r && r.main && !r.far && !r.gate) {
      r.plan = buildPlan(r);
      if (!opts.silent) {
        saveLast();
        if (r.main.an.zones.length && NC.basemap && NC.basemap.suggestIfNeeded && r.routeId) {
          var rid = r.routeId;
          setTimeout(function () { if (S.shown && gen === S.routeGen) NC.basemap.suggestIfNeeded({ route_id: rid, hasLostZone: true }); }, 700);
        }
      }
    }
    if (S.map) {
      drawResult();
      if (opts.fit !== false) fitResult();
    }
    renderSummary();
    renderPlanner();
    renderResult();
    if (S.tab === 'stops') renderStops();
  }

  /* ---------- TripPlan (contract C2) ---------- */
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function keyOfEnd(x, which) {
    if (x === 'me' || (x && x.kind === 'me')) return 'me';
    if (typeof x === 'string') return 'n:' + x;
    if (!x) return '-';
    if (x.kind === 'node') return 'n:' + x.id;
    if (x.id) return x.kind + ':' + x.id;
    return (which || 'p') + ':' + (+x.lat).toFixed(4) + ',' + (+x.lng).toFixed(4);
  }
  /** Stable key of the planned trip ('me' stays 'me' when the position moves, so the active trip still matches). */
  function routeKey(r) {
    return [r.source || 'offline', keyOfEnd(S.from, 'p'), keyOfEnd(S.to, 'p'), r.source === 'online' ? '-' : S.strategy, S.mode, S.carrier].join('|');
  }
  function simplifyLine(g) {
    var P = NC.geoOnline && NC.geoOnline.pure;
    if (P && P.simplifyTo) return P.simplifyTo(g, PLAN_MAX_PTS, 0.005);
    if (g.length <= PLAN_MAX_PTS) return g.slice();
    var step = (g.length - 1) / (PLAN_MAX_PTS - 1), out = [];
    for (var i = 0; i < PLAN_MAX_PTS; i++) out.push(g[Math.round(i * step)]);
    return out;
  }
  /**
   * TripPlan of a result: geometry from the traveller's start (offline: the straight approach legs included) to the
   * destination, ≤ 600 points; zones = 'lost' stretches in km along that geometry.
   */
  function buildPlan(r) {
    if (!r || !r.main) return null;
    var an = r.main.an;
    var geom = an.geometry.map(function (p) { return [+p[0], +p[1]]; });
    var shift = 0, length = an.length_km, unknown = an.unknown_km || 0;
    if (r.source !== 'online') {
      var A = fromLatLng(), B = toLatLng();
      if (A && r.startOff > 0.05) { geom.unshift([A.lat, A.lng]); shift = r.startOff; }
      if (B && r.endOff > 0.05) geom.push([B.lat, B.lng]);
      length = an.length_km + (r.approach || 0);
      unknown = r.approach || 0; // off-network approach legs: no signal data
    }
    var lostParts = an.parts.filter(function (p) { return p.level === 'lost' && p.geometry && p.geometry.length; });
    var zones = an.zones.map(function (z) {
      var inZ = lostParts.filter(function (p) { return p.from_km >= z.start_km - 1e-6 && p.to_km <= z.end_km + 1e-6; });
      var s0 = inZ.length ? inZ[0].geometry[0] : null, e0 = inZ.length ? inZ[inZ.length - 1].geometry[inZ[inZ.length - 1].geometry.length - 1] : null;
      return {
        start_km: r3(z.start_km + shift), end_km: r3(z.end_km + shift), length_km: r3(z.end_km - z.start_km),
        start: s0 ? [+s0[0], +s0[1]] : null, end: e0 ? [+e0[0], +e0[1]] : null
      };
    });
    var dest = toLatLng() || (geom.length ? { lat: geom[geom.length - 1][0], lng: geom[geom.length - 1][1] } : null);
    return {
      route_key: routeKey(r), source: r.source === 'online' ? 'online' : 'offline', route_id: r.routeId || null, carrier: S.carrier,
      mode: S.mode === 'hiking' ? 'hiking' : 'motorbike', speed_kmh: speedOf(S.mode), length_km: r3(length),
      geometry: simplifyLine(geom), zones: zones, unknown_km: r3(unknown),
      from_label: shortName(fromLabel()), to_label: shortName(destLabel(S.to)),
      dest: dest ? [dest.lat, dest.lng] : null, created_at: nowIso()
    };
  }

  var SER_KIND = { fac: 'facility', svc: 'service', point: 'point', place: 'place' };
  var DESER_KIND = { facility: 'fac', service: 'svc', point: 'point', place: 'place' };
  function serializeFrom() {
    if (S.from === 'me') return S.pos ? { lat: S.pos.lat, lng: S.pos.lng, kind: 'position', source: S.pos.source || 'sim' } : null;
    if (S.from && typeof S.from === 'object') return { lat: S.from.lat, lng: S.from.lng, kind: SER_KIND[S.from.kind] || 'point', id: S.from.id || null, label: S.from.kind === 'place' ? S.from.label || null : undefined };
    return S.from;
  }
  function serializeTo() {
    var d = S.to;
    if (!d) return null;
    if (d.kind === 'node') return d.id;
    if (d.kind === 'me') return S.pos ? { lat: S.pos.lat, lng: S.pos.lng, kind: 'position', source: S.pos.source || 'sim' } : null;
    return { lat: d.lat, lng: d.lng, kind: SER_KIND[d.kind] || 'point', id: d.id || null, label: d.kind === 'place' ? d.label || null : undefined };
  }

  /** kv 'map.last_route' — reused by MOD.04 (planned path, Buddy start with a route) and NC.trip (.plan, C2). */
  function saveLast() {
    var r = S.result;
    if (!r || !r.main || !NC.store) return;
    var an = r.main.an;
    var rec = {
      route_id: r.routeId || null, carrier: S.carrier, from: serializeFrom(), to: serializeTo(), strategy: S.strategy, mode: S.mode, at: nowIso(),
      source: r.source === 'online' ? 'online' : 'offline',
      from_label: fromLabel(), to_label: destLabel(S.to), length_km: Math.round(an.length_km * 100) / 100,
      approach_km: Math.round((r.approach || 0) * 100) / 100,
      lost_km: Math.round(an.lost_km * 100) / 100, first_lost_at_km: an.first_lost_at_km === null ? null : Math.round(an.first_lost_at_km * 100) / 100,
      unknown_km: Math.round((an.unknown_km || 0) * 100) / 100,
      plan: r.plan || buildPlan(r)
    };
    // online route: a finer copy of the geometry (≤ 2000 points) so it comes back after a reload without a request
    if (r.source === 'online') {
      var P = NC.geoOnline && NC.geoOnline.pure;
      var g = an.geometry.map(function (p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]; });
      rec.online_geometry = P && P.simplifyTo ? P.simplifyTo(g, 2000, 0.005) : g.slice(0, 2000);
      rec.online_profile = r.online ? r.online.profile || null : null;
    }
    NC.store.set(KV_LAST, rec).catch(function () { });
    if (NC.bus) NC.bus.emit('map:route', rec);
  }

  function restoreEnd(x, which) {
    if (typeof x === 'string') return which === 'from' ? (node(x) ? x : null) : destFor(x);
    if (!x || typeof x !== 'object') return null;
    if (x.kind === 'position') return which === 'from' ? 'me' : (S.pos ? { kind: 'me' } : null);
    if (x.kind === 'place' && isFinite(x.lat)) {
      var pl = { kind: 'place', id: x.id || null, lat: +x.lat, lng: +x.lng, label: x.label || null };
      return which === 'from' ? asFrom(pl) : pl;
    }
    var k = DESER_KIND[x.kind];
    var d = k && k !== 'point' && x.id ? destFor(x.id) : null;
    if (d) return which === 'from' ? asFrom(d) : d;
    if (isFinite(x.lat)) return which === 'from' ? { kind: 'point', lat: +x.lat, lng: +x.lng } : { kind: 'point', lat: +x.lat, lng: +x.lng };
    return null;
  }
  function restoreLast() {
    if (S.restored || !NC.store) return Promise.resolve(false);
    S.restored = true;
    return NC.store.get(KV_LAST).catch(function () { return null; }).then(function (rec) {
      if (!rec || !S.graph || S.to) return false;
      if (rec.carrier && rec.carrier !== S.carrier) return false;
      var isOnline = rec.source === 'online';
      // The graph holds every pilot route: an offline trip saved on another route (e.g. the route was changed in
      // Settings) must not come back under this route's header, off-screen and out of the fitted view.
      if (!isOnline && rec.route_id && rec.route_id !== S.routeId) return false;
      var to = restoreEnd(rec.to, 'to');
      if (!to) return false;
      S.from = restoreEnd(rec.from, 'from') || 'me';
      S.to = to;
      if (rec.strategy === 'shortest' || rec.strategy === 'signal') S.strategy = rec.strategy;
      // an online route comes back from its saved plan geometry — no request, works offline
      var pl = rec.plan;
      if (isOnline && pl && Array.isArray(pl.geometry) && pl.geometry.length > 1) {
        // the live-position end is matched against the saved start (a new fix on / near the route keeps it)
        var g = Array.isArray(rec.online_geometry) && rec.online_geometry.length > 1 ? rec.online_geometry : pl.geometry, g0 = { lat: g[0][0], lng: g[0][1] }, gN = { lat: g[g.length - 1][0], lng: g[g.length - 1][1] };
        var A = S.from === 'me' ? g0 : llOf(fromPoint()) || g0;
        var B = endIsMe('to') ? gN : llOf(toPoint()) || gN;
        S.onlineCache.push({ a: A, b: B, mode: pl.mode === 'hiking' ? 'hiking' : 'motorbike', restored: true,
          route: { geometry: g, distance_km: pl.length_km, duration_min: null, profile: pl.mode === 'hiking' ? 'foot' : 'car' } });
        if (pl.mode && MODE_ICON[pl.mode] && pl.mode !== S.mode) S.mode = pl.mode;
      }
      computeRoute({ silent: true, fit: false });
      return true;
    });
  }

  /* ================================================================== map drawing */
  function L() { return window.L; }
  function clearGroup(key) {
    if (S.lg[key]) { try { S.map.removeLayer(S.lg[key]); } catch (e) { /* ignore */ } S.lg[key] = null; }
  }

  function drawAll() {
    if (!S.map || !S.graph) return;
    drawNetwork();
    drawResult();
    drawNodes();
    drawPois();
    drawUser();
    S.root.classList.toggle('mp-sig-on', !!S.layers.signal);
    if (!S.layers.signal) toggleLegend(false); // the legend (and its FAB) only exist with the signal layer
  }

  function drawNetwork() {
    clearGroup('net');
    if (S.layers.signal) S.lg.net = NC.mapkit.drawEdges(S.map, S.graph, { weight: 5 });
    else {
      var g = L().layerGroup();
      Object.keys(S.graph.edges).forEach(function (id) {
        var e = S.graph.edges[id];
        if (e.geometry.length < 2) return;
        g.addLayer(L().polyline(e.geometry, { className: 'mp-net-casing', weight: 9, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }));
        g.addLayer(L().polyline(e.geometry, { className: 'mp-net-plain', weight: 4, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }));
      });
      S.lg.net = g.addTo(S.map);
    }
    dimNetwork();
  }

  function dimNetwork() {
    var dim = !!(S.result && S.result.main && !S.result.far);
    if (S.lg.net) {
      S.lg.net.eachLayer(function (l) {
        if (!l.setStyle) return;
        var casing = l.options && /casing/.test(l.options.className || '');
        l.setStyle({ opacity: dim ? (casing ? 0.45 : 0.3) : (casing ? 0.95 : 1) });
      });
    }
    if (S.root) S.root.classList.toggle('mp-has-route', dim);
  }

  function drawResult() {
    ['alt', 'route', 'zones', 'pins'].forEach(clearGroup);
    dimNetwork();
    var r = S.result;
    if (r && r.main && !r.far) {
      var Lf = L();
      if (r.other && !r.same) {
        var alt = Lf.layerGroup();
        var ag = r.other.an.geometry;
        alt.addLayer(Lf.polyline(ag, { className: 'mp-alt-casing', weight: 9, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }));
        var line = Lf.polyline(ag, { className: 'mp-alt', weight: 4, opacity: 1, dashArray: '1 9', lineCap: 'round', lineJoin: 'round' });
        line.bindTooltip(esc(t('mp.cmp.alt_tip', { name: t('mp.strategy.' + r.other.strategy), km: km(r.other.an.length_km), lost: km(r.other.an.lost_km) })), { sticky: true, className: 'mp-tip' });
        line.on('click', function () { setStrategy(r.other.strategy); });
        alt.addLayer(line);
        S.lg.alt = alt.addTo(S.map);
      }
      if (S.layers.signal) S.lg.route = NC.mapkit.drawRoute(S.map, r.main.an, { weight: 7 });
      else {
        S.lg.route = Lf.layerGroup([
          Lf.polyline(r.main.an.geometry, { className: 'mp-net-casing', weight: 12, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }),
          Lf.polyline(r.main.an.geometry, { className: 'mp-route-plain', weight: 7, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' })
        ]).addTo(S.map);
      }
      var zg = Lf.layerGroup();
      var first = true;
      r.main.an.parts.forEach(function (p) {
        if (p.level !== 'lost' || !p.geometry || !p.geometry.length) return;
        var len = p.to_km - p.from_km;
        if (!first && len < 2) return;
        first = false;
        // 24px visual; on touch screens a transparent 44px hit box around it (contract: touch targets >= 44 px)
        var hit = coarse() ? 44 : 24;
        var mk = Lf.marker(p.geometry[0], {
          icon: Lf.divIcon({ className: 'mp-zone-wrap' + (hit > 24 ? ' mp-zone-wrap--hit' : ''), html: '<span class="mp-zone">' + ic('wifi-off') + '</span>', iconSize: [hit, hit], iconAnchor: [hit / 2, hit / 2] }),
          keyboard: false, zIndexOffset: 300
        });
        mk.bindTooltip(esc(t('mp.zone.tip', { a: num(p.from_km, 1), b: num(p.to_km, 1), len: km(len) })), { direction: 'top', offset: [0, -12], className: 'mp-tip' });
        zg.addLayer(mk);
      });
      S.lg.zones = zg.addTo(S.map);
    }
    drawPins();
    declutterLabels();
  }

  function pinIcon(kind) {
    return L().divIcon({
      className: 'mp-pin-wrap', iconSize: [34, 42], iconAnchor: [17, 38], popupAnchor: [0, -34],
      html: '<span class="mp-pin mp-pin--' + kind + '">' + (kind === 'to' ? ic('flag') : '<i></i>') + '</span>'
    });
  }
  function drawPins() {
    clearGroup('pins');
    if (!S.map) return;
    var g = L().layerGroup();
    if (S.from !== 'me') {
      var fp = fromLatLng();
      if (fp) g.addLayer(L().marker([fp.lat, fp.lng], { icon: pinIcon('from'), keyboard: false, interactive: false, zIndexOffset: 900 }));
    }
    var tp = endIsMe('to') ? null : toLatLng(); // "my location" as destination is already the pulsing user marker
    if (tp) g.addLayer(L().marker([tp.lat, tp.lng], { icon: pinIcon('to'), keyboard: false, interactive: false, zIndexOffset: 950 }));
    S.lg.pins = g.addTo(S.map);
  }

  function drawNodes() {
    clearGroup('nodes');
    var g = L().layerGroup();
    Object.keys(S.graph.nodes).forEach(function (id) {
      var n = S.graph.nodes[id];
      var major = n.kind === 'town';
      var m = L().circleMarker([n.lat, n.lng], {
        radius: major ? 5.5 : 4, weight: major ? 2.5 : 2, opacity: 1, fillOpacity: 1, bubblingMouseEvents: false,
        className: 'mp-node mp-node--' + n.kind + (major ? ' mp-node--major' : '')
      });
      m.bindTooltip(esc(shortName(nodeName(n))), {
        permanent: true, direction: 'right', offset: [LABEL_OFFSET, 0], interactive: false,
        className: 'mp-label ' + (major ? 'mp-label--major' : 'mp-label--minor')
      });
      m.bindPopup(function () { return nodePopup(id); }, popOpts({ maxWidth: 270, minWidth: 210 }));
      m._mpNode = id;
      g.addLayer(m);
    });
    S.lg.nodes = g.addTo(S.map);
    syncZoomClass();
  }

  function drawPois() {
    clearGroup('fac');
    clearGroup('svc');
    if (S.layers.med) {
      var fg = L().layerGroup();
      S.facilities.forEach(function (f) {
        var sel = !!(S.to && S.to.kind === 'fac' && S.to.id === f.id);
        var m = NC.mapkit.poiMarker(f, 'facility', { selected: sel, size: sel ? 34 : 28 });
        m.bindPopup(function () { return facPopup(f.id); }, popOpts({ maxWidth: 290, minWidth: 230 }));
        fg.addLayer(m);
      });
      S.lg.fac = fg.addTo(S.map);
    }
    if (S.layers.svc) {
      var sg = L().layerGroup();
      S.graph.services.forEach(function (s) {
        var m = NC.mapkit.poiMarker(s, 'service', { size: 24 });
        m.bindPopup(function () { return svcPopup(s.id); }, popOpts({ maxWidth: 280, minWidth: 220 }));
        sg.addLayer(m);
      });
      S.lg.svc = sg.addTo(S.map);
    }
    if (S.decl) S.decl.update();
    scheduleDeclutter();
  }

  function drawUser() {
    clearGroup('user');
    if (!S.map || !S.pos) return;
    S.lg.user = NC.mapkit.userMarker(S.pos).addTo(S.map);
  }

  function syncZoomClass() {
    if (!S.map || !S.root) return;
    var z = S.map.getZoom();
    S.root.classList.toggle('mp-z-vlow', z < 8);
    S.root.classList.toggle('mp-z-low', z < 10.5);
    declutterLabels();
  }

  /*
   * Permanent node labels must never overprint each other ("YêNgã ba ĐT176") nor a marker icon. After every zoom /
   * redraw a screen-space pass places them greedily by priority: towns, the planned trip's ends, nodes on the planned
   * route, then passes / viewpoints / villages, junctions last. Each label keeps its right-hand side if free, else
   * moves to the left of its node (towns may also go below / above); towns and the trip's places may also take a
   * diagonal or slide past an icon next to the node (LABEL_PUSH). A label that still has no free spot is hidden for
   * this zoom (the node dot and its popup stay). Labels already hidden by the zoom classes (.mp-z-low / .mp-z-vlow)
   * measure 0 and are skipped. All reads happen before any write.
   */
  var LABEL_OFFSET = 7;
  var LABEL_PUSH = 40; // px a label may slide away from its node to clear an icon (≈ the selected 34 px POI + margin)
  var LABEL_KIND_RANK = { trailhead: 0, pass: 1, viewpoint: 1, poi: 2, village: 2, junction: 3 };
  var LABEL_SIDES = { town: ['right', 'left', 'bottom', 'top'], minor: ['right', 'left'] };
  var LABEL_OFF = { right: [LABEL_OFFSET, 0], left: [-LABEL_OFFSET, 0], bottom: [0, LABEL_OFFSET], top: [0, -LABEL_OFFSET] };

  /*
   * Floating overlays. The chips, FAB column, legend, "far" card, Leaflet controls and (on phones) the bottom sheet
   * all sit ON the map. overlayRects() measures the visible ones in map-container pixels; pads() frames the map
   * inside the space they leave free, and the declutter pass below treats them as obstacles so no label or marker
   * is left hidden under a control after a fit, pan, zoom, resize or sheet move.
   */
  var MARK_R = 18; // ≈ half of the largest POI icon: fitBounds frames points, the icons extend around them
  var UNDER_MIN = 0.12; // a marker more than 12 % covered by a control is hidden until the map moves it clear
  function overlayRects() {
    if (!S.els || !S.els.map || !S.root) return null;
    var mr = S.els.map.getBoundingClientRect();
    if (!mr.width || !mr.height) return null;
    var W = mr.width, H = mr.height, boxes = [];
    function push(x, y, r, b, kind) {
      if (r <= 0 || b <= 0 || x >= W || y >= H || r - x < 1 || b - y < 1) return;
      boxes.push({ x: x, y: y, r: r, b: b, kind: kind });
    }
    function add(el, kind, pad) {
      if (!el || el.hidden) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var p = pad || 0;
      push(r.left - mr.left - p, r.top - mr.top - p, r.right - mr.left + p, r.bottom - mr.top + p, kind);
    }
    if (S.els.top) U.$$('.chip, button', S.els.top).forEach(function (el) { add(el, 'top', 4); });
    U.$$('.mp-fab', S.root).forEach(function (el) { add(el, 'fab', 4); });
    add(S.els.far, 'far', 4);
    add(S.els.pick, 'top', 4);
    var legend = S.root.querySelector('#mp-legend'), notice = S.els.map.querySelector('.mk-notice');
    var ctls = U.$$('.leaflet-control-zoom, .leaflet-control-attribution', S.els.map);
    if (!isSheet()) {
      add(legend, 'legend', 4);
      add(notice, 'legend', 4);
      ctls.forEach(function (el) { add(el, 'ctl', 2); });
    } else {
      // Phone sheet. It covers the map from its top edge down (at "full" the map is hidden anyway: frame as for
      // "half"). The legend, the tiles notice and Leaflet's bottom controls ride on the sheet with a 0.4 s CSS
      // transition, so right after a snap change their rects are mid-animation: place them at their FINAL offsets
      // instead (map.css: legend = occ + 30 px, notice = occ + 84 px, .leaflet-bottom = occ above the map bottom).
      var m = S.m || metrics();
      var vis = S.snap === 'full' ? m.half : m[S.snap];
      var occ = S.snap === 'full' ? 0 : m[S.snap];
      if (vis) push(0, S.root.getBoundingClientRect().bottom - vis - mr.top, W, H, 'panel');
      if (S.snap !== 'full') {
        var atBottom = function (el, lift, kind, pad) {
          if (!el || el.hidden) return;
          var r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          var y = H - occ - lift - r.height; // container px
          push(r.left - mr.left - pad, y - pad, r.right - mr.left + pad, y + r.height + pad, kind);
        };
        atBottom(legend, 30, 'legend', 4);
        atBottom(notice, 84, 'legend', 4);
        U.$$('.leaflet-bottom', S.els.map).forEach(function (cont) {
          var cr = cont.getBoundingClientRect(), dy = (mr.bottom - occ) - cr.bottom;
          U.$$('.leaflet-control-zoom, .leaflet-control-attribution', cont).forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            push(r.left - mr.left - 2, r.top - mr.top + dy - 2, r.right - mr.left + 2, r.bottom - mr.top + dy + 2, 'ctl');
          });
        });
      }
    }
    return { W: W, H: H, boxes: boxes };
  }
  function hit(a, b) { return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b; }
  var TARGET_MIN = 24; // WCAG 2.5.8: an interactive marker must keep a 24 px target clear of controls and map edges
  /* true when a control or the map edge leaves less than TARGET_MIN px of the box visible along either axis */
  function tooClipped(a, ov) {
    var w = a.r - a.x, h = a.b - a.y;
    var x = Math.max(0, a.x), y = Math.max(0, a.y), r = Math.min(ov.W, a.r), b = Math.min(ov.H, a.b);
    var visW = r - x, visH = b - y;
    if (visW <= 0 || visH <= 0) return false; // fully off the map: nothing to hide
    for (var k = 0; k < ov.boxes.length; k++) {
      var o = ov.boxes[k];
      var ow = Math.min(r, o.r) - Math.max(x, o.x), oh = Math.min(b, o.b) - Math.max(y, o.y);
      if (ow <= 0 || oh <= 0) continue;
      if (oh >= visH / 2) visW -= ow;
      if (ow >= visW / 2) visH -= oh;
    }
    return (visW < w || visH < h) && (visW < Math.min(TARGET_MIN, w) || visH < Math.min(TARGET_MIN, h));
  }
  function coverage(a, boxes) {
    var area = Math.max(1, (a.r - a.x) * (a.b - a.y)), c = 0;
    for (var k = 0; k < boxes.length; k++) {
      var b = boxes[k];
      var w = Math.min(a.r, b.r) - Math.max(a.x, b.x), h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) c += w * h;
    }
    return Math.min(1, c / area);
  }
  /* rAF-throttled full pass (labels + markers); cheap enough to run after every move/zoom/resize/sheet change. */
  function scheduleDeclutter() {
    if (S.declT) return;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    S.declT = raf(function () { S.declT = 0; declutterLabels(); });
  }
  /*
   * Hide POI markers and node dots that a floating control covers (> UNDER_MIN of their box): a half-covered icon
   * is unreadable and fails WCAG target-size. The selected destination and a marker with an open popup always stay.
   * Hidden markers are also removed from the tab order; every facility stays reachable in the "Y tế gần nhất" list.
   */
  function avoidMarkers(ov) {
    if (!S.map || !ov) return;
    var mr = S.els.map.getBoundingClientRect(), list = [];
    ['fac', 'svc'].forEach(function (k) {
      var g = S.lg[k];
      if (g && S.map.hasLayer(g)) g.eachLayer(function (m) { list.push({ m: m, el: m.getElement ? m.getElement() : m._icon, poi: true }); });
    });
    if (S.lg.nodes && S.map.hasLayer(S.lg.nodes)) S.lg.nodes.eachLayer(function (m) { list.push({ m: m, el: m._path, poi: false }); });
    // start / destination pins and dead-zone markers: the fit keeps them clear; after a pan they hide like the rest
    ['pins', 'zones'].forEach(function (k) {
      var g = S.lg[k];
      if (g && S.map.hasLayer(g)) g.eachLayer(function (m) { if (m.getElement) list.push({ m: m, el: m.getElement(), poi: false, target: k === 'zones' }); });
    });
    var reads = list.map(function (o) {
      if (!o.el) return null;
      var keep = o.poi && ((o.m.isPopupOpen && o.m.isPopupOpen()) ||
        !!(S.to && (S.to.kind === 'fac' || S.to.kind === 'svc') && o.m.poi && S.to.id === o.m.poi.id));
      var r = o.el.getBoundingClientRect();
      if (!r.width || !r.height) return { o: o, under: false };
      var box = { x: r.left - mr.left, y: r.top - mr.top, r: r.right - mr.left, b: r.bottom - mr.top };
      var under = coverage(box, ov.boxes) > UNDER_MIN || ((o.poi || o.target) && tooClipped(box, ov));
      return { o: o, under: !keep && under };
    });
    reads.forEach(function (x) {
      if (!x) return;
      var el = x.o.el, was = el.classList.contains('mp-under');
      if (was === x.under) return;
      el.classList.toggle('mp-under', x.under);
      if (!x.o.poi) return;
      if (x.under) {
        if (el.hasAttribute('tabindex')) el.setAttribute('data-mp-ti', el.getAttribute('tabindex'));
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-hidden', 'true');
      } else {
        var ti = el.getAttribute('data-mp-ti');
        if (ti !== null) { el.setAttribute('tabindex', ti); el.removeAttribute('data-mp-ti'); } else el.removeAttribute('tabindex');
        if (!el.classList.contains('mk-poi-wrap--culled')) el.removeAttribute('aria-hidden');
      }
    });
  }

  function declutterLabels() {
    if (!S.map || !S.map._loaded) return;
    var ov = overlayRects();
    placeLabels(ov);
    avoidMarkers(ov);
  }
  function placeLabels(ov) {
    if (!S.lg.nodes || !S.graph) return;
    var map = S.map, ends = {}, onRoute = {}, items = [];
    // Overlays and the visible map area in layer coordinates (labels are placed in layer space).
    var obs = [], view = null;
    if (ov) {
      var o0 = map.containerPointToLayerPoint([0, 0]);
      view = { x: o0.x, y: o0.y, r: o0.x + ov.W, b: o0.y + ov.H };
      ov.boxes.forEach(function (b) { obs.push({ x: b.x + o0.x, y: b.y + o0.y, r: b.r + o0.x, b: b.b + o0.y }); });
    }
    function clearOv(b) {
      for (var k = 0; k < obs.length; k++) if (hit(b, obs[k])) return false;
      return true;
    }
    // Visible markers (facilities, services, start / destination pins, dead-zone dots, you-are-here) are obstacles
    // too: a label takes a side clear of them instead of being printed under / over an icon (UX.12).
    var marks = [];
    if (ov) {
      var mr0 = S.els.map.getBoundingClientRect(), o1 = map.containerPointToLayerPoint([0, 0]);
      ['fac', 'svc', 'pins', 'zones', 'user'].forEach(function (k) {
        var g = S.lg[k];
        if (!g || !map.hasLayer(g)) return;
        var each = g.eachLayer ? function (f) { g.eachLayer(f); } : function (f) { f(g); };
        each(function (m) {
          var el = m.getElement ? m.getElement() : m._icon;
          if (!el || el.classList.contains('mk-poi-wrap--culled') || el.classList.contains('mp-under')) return;
          var vis = el.querySelector('.mk-poi, .mp-pin, .mp-zone, .mk-user__dot') || el; // the icon, not its 44 px touch box
          var r = vis.getBoundingClientRect();
          if (!r.width || !r.height) return;
          marks.push({ x: r.left - mr0.left + o1.x - 1, y: r.top - mr0.top + o1.y - 1, r: r.right - mr0.left + o1.x + 1, b: r.bottom - mr0.top + o1.y + 1 });
        });
      });
      // the other places' dots too: a name printed across another town's dot reads as that town's (a label's own dot
      // never meets its box — LABEL_OFFSET + the tooltip margin clear the 6.75 px dot)
      S.lg.nodes.eachLayer(function (m) {
        if (!m.getLatLng || (m._path && m._path.classList.contains('mp-under'))) return;
        var c = map.latLngToLayerPoint(m.getLatLng()), rr = (m.getRadius ? m.getRadius() : 4) + (m.options.weight || 2) / 2 + 1;
        marks.push({ x: c.x - rr, y: c.y - rr, r: c.x + rr, b: c.y + rr });
      });
    }
    // tol > 0: the box may graze an icon's edge by up to tol px (touching), never cover it
    function clearMarks(b, tol) {
      var d = tol || 0;
      for (var k = 0; k < marks.length; k++) {
        var q = marks[k];
        if (hit(b, { x: q.x + d, y: q.y + d, r: q.r - d, b: q.b - d })) return false;
      }
      return true;
    }
    function markHit(b) {
      for (var k = 0; k < marks.length; k++) if (hit(b, marks[k])) return marks[k];
      return null;
    }
    function inView(b) { return !view || (b.x >= view.x && b.r <= view.r && b.y >= view.y && b.b <= view.b); }
    function onScreen(p) { return !view || (p.x >= view.x && p.x <= view.r && p.y >= view.y && p.y <= view.b); }
    function pointUnder(p) { return !clearOv({ x: p.x - 4, y: p.y - 4, r: p.x + 4, b: p.y + 4 }); }
    if (typeof S.from === 'string' && S.from !== 'me') ends[S.from] = true;
    if (S.to && S.to.kind === 'node') ends[S.to.id] = true;
    var r = S.result;
    if (r && r.main && !r.far && r.main.an && r.main.an.nodeIds) r.main.an.nodeIds.forEach(function (id) { onRoute[id] = true; });
    S.lg.nodes.eachLayer(function (m) {
      var tt = m.getTooltip ? m.getTooltip() : null;
      var el = tt && tt.getElement ? tt.getElement() : null;
      var n = m._mpNode ? node(m._mpNode) : null;
      if (!el || !n) return;
      var w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      var gap = LABEL_OFFSET;
      try { // + Leaflet's ±6 px .leaflet-tooltip-{side} margin
        var cs = window.getComputedStyle(el);
        gap += Math.max(Math.abs(parseFloat(cs.marginLeft)) || 0, Math.abs(parseFloat(cs.marginTop)) || 0);
      } catch (e) { /* keep the offset alone */ }
      var kr = LABEL_KIND_RANK[n.kind];
      var town = n.kind === 'town';
      items.push({
        tt: tt, el: el, p: map.latLngToLayerPoint(m.getLatLng()), w: w, h: h, gap: gap, town: town, i: items.length,
        // towns first (the trip's own towns before the others), then the trip's other places, route nodes, the rest
        pri: town ? (ends[n.id] ? 0 : onRoute[n.id] ? 0.1 : 0.2) : ends[n.id] ? 1 : onRoute[n.id] ? 2 : 3 + (kr === undefined ? 4 : kr)
      });
    });
    items.sort(function (a, b) { return (a.pri - b.pri) || (a.i - b.i); });
    var placed = [];
    // c = { side, dx, dy }: Leaflet direction + an extra shift (px) on top of LABEL_OFF[side]
    function box(o, c) {
      var x = o.p.x + o.gap, y = o.p.y - o.h / 2;
      if (c.side === 'left') x = o.p.x - o.gap - o.w;
      else if (c.side === 'top' || c.side === 'bottom') { x = o.p.x - o.w / 2; y = c.side === 'top' ? o.p.y - o.gap - o.h : o.p.y + o.gap; }
      x += c.dx; y += c.dy;
      return { x: x, y: y, r: x + o.w, b: y + o.h };
    }
    function free(b) {
      for (var k = 0; k < placed.length; k++) {
        var q = placed[k];
        if (b.x < q.r + 2 && q.x < b.r + 2 && b.y < q.b && q.y < b.b) return false;
      }
      return true;
    }
    // Candidate spots: the sides (minor labels: right / left), then — for towns and the trip's places — the four
    // diagonals (the label's corner next to the node).
    function cands(o) {
      var sides = o.town ? LABEL_SIDES.town : LABEL_SIDES.minor, out = [], k;
      for (k = 0; k < sides.length; k++) out.push({ side: sides[k], dx: 0, dy: 0 });
      if (o.pri <= 2) {
        var dy = Math.round(o.h / 2 + 3);
        ['right', 'left'].forEach(function (s) { out.push({ side: s, dx: 0, dy: -dy }, { side: s, dx: 0, dy: dy }); });
      }
      return out;
    }
    // The same spot slid outwards past the icon(s) in the way — a hospital or the destination pin right at a town —
    // so the name sits beside the cluster instead of on top of an icon. null when that needs more than LABEL_PUSH px.
    function pushed(o, c0) {
      var c = { side: c0.side, dx: c0.dx, dy: c0.dy }, b = box(o, c), q;
      for (var it = 0; it < 4; it++) {
        q = markHit(b);
        if (!q) return Math.abs(c.dx - c0.dx) + Math.abs(c.dy - c0.dy) <= LABEL_PUSH ? { c: c, b: b } : null;
        if (c.side === 'right') c.dx += Math.ceil(q.r - b.x + 1);
        else if (c.side === 'left') c.dx -= Math.ceil(b.r - q.x + 1);
        else if (c.side === 'top') c.dy -= Math.ceil(b.b - q.y + 1);
        else c.dy += Math.ceil(q.b - b.y + 1);
        b = box(o, c);
      }
      return null;
    }
    items.forEach(function (o) {
      var list = cands(o), b = null, k, c, p, best = null, cost;
      o.c = { side: 'right', dx: 0, dy: 0 };
      if (!onScreen(o.p)) { o.hide = true; return; } // node off-screen: no stray label at the edge (re-checked on moveend)
      if (pointUnder(o.p)) { o.hide = true; return; } // the node itself is under a control
      function take(cc, bb) { b = bb; o.c = cc; }
      // 1) a spot clear of other labels, of the markers, of every control and inside the visible map
      for (k = 0; k < list.length && !b; k++) {
        c = list[k];
        p = box(o, c);
        if (free(p) && clearMarks(p) && clearOv(p) && inView(p)) take(c, p);
      }
      // 2) towns and the trip's places: a spot that only grazes an icon's edge (≤ 3 px) stays next to its node…
      for (k = 0; o.pri <= 2 && k < list.length && !b; k++) {
        c = list[k];
        p = box(o, c);
        if (free(p) && clearMarks(p, 3) && clearOv(p) && inView(p)) take(c, p);
      }
      // 3) …else slide past the icons in the way (the shortest slide wins). Text is never printed over an icon or over
      //    another label (UX.12): when nothing fits, the label hides until zoomed in — the node dot and its popup stay
      for (k = 0; o.pri <= 2 && !b && k < list.length; k++) {
        p = pushed(o, list[k]);
        if (!p || !free(p.b) || !clearOv(p.b) || !inView(p.b)) continue;
        cost = Math.abs(p.c.dx - list[k].dx) + Math.abs(p.c.dy - list[k].dy);
        if (!best || cost < best.cost) best = { c: p.c, b: p.b, cost: cost };
      }
      if (best) take(best.c, best.b);
      // 4) towns: clipped by the map edge (but clear of controls, icons and labels) beats hiding
      for (k = 0; o.town && k < list.length && !b; k++) {
        c = list[k];
        p = box(o, c);
        if (free(p) && clearMarks(p, 3) && clearOv(p)) take(c, p);
      }
      o.hide = !b;
      if (b) placed.push(b);
    });
    items.forEach(function (o) {
      var off = LABEL_OFF[o.c.side], ox = off[0] + o.c.dx, oy = off[1] + o.c.dy, cur = o.tt.options.offset;
      var same = o.tt.options.direction === o.c.side && cur && cur[0] === ox && cur[1] === oy;
      if (!same) {
        o.tt.options.direction = o.c.side;
        o.tt.options.offset = [ox, oy];
        try { o.tt.update(); } catch (e) { /* map torn down meanwhile */ }
      }
      o.el.classList.toggle('mp-label--culled', o.hide);
    });
  }

  /* ---------- camera ---------- */
  function padsFallback() {
    var top = S.els.top ? S.els.top.offsetTop + S.els.top.offsetHeight : 0;
    if (isSheet()) {
      var m = S.m || metrics();
      var vis = S.snap === 'full' ? m.half : m[S.snap];
      var leg = S.layers.signal ? 84 : 30; // legend (up to 2 rows, + attribution row) sits above the panel
      return { tl: [18, top + 16], br: [62, vis + leg] };
    }
    return { tl: [28, top + 24], br: [76, 30] };
  }
  /*
   * Fit padding = the free space the floating overlays leave, measured on screen, plus a margin so a marker icon (not
   * just its point) clears them. Chips → top, FAB column → its side, the phone sheet (and what rides on it) → bottom.
   * Every other overlay (legend, tiles notice, zoom / attribution, far card) pushes the ONE edge that costs the fitted
   * target the least: e.g. the zoom buttons in the bottom-right corner push the right edge (already taken by the FAB
   * column) instead of the whole bottom — on a short landscape map that is the difference between a usable route and
   * a blob (R5.4). `target` = {w, h} pixel extent of what is being fitted (any zoom; only the ratio matters).
   */
  function pads(target) {
    var ov = overlayRects();
    if (!ov) return padsFallback();
    var W = ov.W, H = ov.H, e = { t: 0, r: 0, b: 0, l: 0 }, sheet = isSheet(), rest = [];
    ov.boxes.forEach(function (b) {
      var cx = (b.x + b.r) / 2;
      if (b.kind === 'top') e.t = Math.max(e.t, b.b);
      else if (b.kind === 'panel') e.b = Math.max(e.b, H - b.y);
      else if (b.kind === 'fab') { if (cx > W / 2) e.r = Math.max(e.r, W - b.x); else e.l = Math.max(e.l, b.r); }
      // phone sheet: legend / notice / Leaflet bottom controls ride on the sheet — always the bottom edge, even
      // when the sheet is high enough to put them in the upper half of the map container
      else if (sheet && (b.kind === 'legend' || b.kind === 'ctl')) e.b = Math.max(e.b, H - b.y);
      else rest.push(b);
    });
    var tw = target && target.w > 0 ? target.w : 0, th = target && target.h > 0 ? target.h : 0;
    function score(x) {
      var fw = Math.max(1, W - x.l - x.r), fh = Math.max(1, H - x.t - x.b);
      return tw && th ? Math.min(fw / tw, fh / th) * 1e6 + fw * fh / 1e3 : fw * fh; // scale of the fit first, then area
    }
    rest.sort(function (a, b) { return (b.r - b.x) * (b.b - b.y) - (a.r - a.x) * (a.b - a.y); });
    rest.forEach(function (b) {
      var best = null;
      [['t', b.b], ['b', H - b.y], ['l', b.r], ['r', W - b.x]].forEach(function (o) {
        var x = { t: e.t, r: e.r, b: e.b, l: e.l };
        x[o[0]] = Math.max(x[o[0]], o[1]);
        var sc = score(x);
        if (!best || sc > best.sc) best = { k: o[0], v: o[1], sc: sc };
      });
      e[best.k] = Math.max(e[best.k], best.v);
    });
    // marker margin: MARK_R + 6 on roomy maps, less on short / narrow ones (a landscape phone map is ~250–330 px tall)
    var M = Math.max(12, Math.min(MARK_R + 6, Math.round(Math.min(W, H) * 0.05)));
    var p = { tl: [e.l + M, e.t + M], br: [e.r + M, e.b + M] };
    // Tiny viewports (landscape phones): keep at least 72 px of each axis for the content itself.
    [[0, W], [1, H]].forEach(function (ax) {
      var i = ax[0], sum = p.tl[i] + p.br[i], max = ax[1] - 72;
      if (max > 0 && sum > max) { p.tl[i] *= max / sum; p.br[i] *= max / sum; }
    });
    p.tl = [Math.round(p.tl[0]), Math.round(p.tl[1])];
    p.br = [Math.round(p.br[0]), Math.round(p.br[1])];
    return p;
  }
  /*
   * Programmatic framing. S.autoFit stays true until the user pans/zooms, so a late container resize (WebKit settles
   * layout after the first fit, rotation, panel resize) re-frames the same target instead of leaving it off-screen.
   */
  function fitBounds(b, maxZoom) {
    if (!S.map || !S.shown || !b || !b.isValid()) return;
    S.fitting = true;
    try {
      try { S.map.invalidateSize(false); } catch (e) { /* ignore */ }
      var tgt = null;
      try {
        var p0 = S.map.project(b.getSouthWest(), 12), p1 = S.map.project(b.getNorthEast(), 12);
        tgt = { w: Math.abs(p1.x - p0.x), h: Math.abs(p0.y - p1.y) };
      } catch (e) { tgt = null; }
      var p = pads(tgt);
      S.map.fitBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: maxZoom || 14, animate: false });
    } finally { S.fitting = false; }
    S.autoFit = true;
    syncZoomClass();
    releaseTiles(140); // after the last of a burst of fits (sheet snap, late layout) the view is final
  }
  /* Raster tiles start loading once the first framing has settled (or the user moves the map, or after a timeout). */
  function releaseTiles(delay) {
    if (!S.tilesHeld || !S.map) return;
    clearTimeout(S.tilesT);
    S.tilesT = setTimeout(function () {
      if (!S.tilesHeld || !S.map) return;
      S.tilesHeld = false;
      if (NC.mapkit.releaseTiles) NC.mapkit.releaseTiles(S.map);
    }, delay || 0);
  }
  function fitRoute() {
    var r = routeMeta(S.routeId);
    S.lastFit = fitRoute;
    if (r && r.bbox) fitBounds(L().latLngBounds([r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]), 13);
  }
  function fitResult() {
    var r = S.result;
    S.lastFit = fitResult;
    if (r && ((r.main && r.far) || (r.gate && !r.main))) {
      var pts = [fromLatLng(), toLatLng()].filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
      if (pts.length) return fitBounds(L().latLngBounds(pts.length > 1 ? pts : [pts[0], pts[0]]), 12);
    }
    if (r && r.main && r.main.an.geometry.length > 1) fitBounds(L().latLngBounds(r.main.an.geometry), 14);
    else fitRoute();
  }
  /* User interaction ends auto-framing (programmatic moves run inside fitBounds with S.fitting = true). */
  function onUserMove() { if (!S.fitting) { S.autoFit = false; releaseTiles(0); } }
  function onMapResize() {
    if (S.fitting) return;
    clearTimeout(S.refitT);
    S.refitT = setTimeout(function () {
      if (!S.shown || !S.map || !S.autoFit || !S.lastFit) return;
      S.lastFit();
    }, 60);
  }

  /* ---------- popups ---------- */
  function popBtn(act, label, iconName, variant, data) {
    var attrs = Object.keys(data || {}).map(function (k) { return ' data-' + k + '="' + esc(data[k]) + '"'; }).join('');
    return '<button type="button" class="btn btn--sm btn--' + (variant || 'soft') + '" data-mp="' + act + '"' + attrs + '>' + ic(iconName) + '<span>' + esc(label) + '</span></button>';
  }
  function nodePopup(id) {
    var n = node(id);
    if (!n) return '';
    return '<div class="mp-pop"><p class="mp-pop__title">' + esc(nodeName(n)) + '</p>' +
      '<p class="mp-pop__meta">' + esc(t('mp.kind.' + n.kind)) + ' · ' + esc(shortName(routeName(n.route_id))) + '</p>' +
      '<div class="mp-pop__btns">' + popBtn('node-to', t('mp.node.to'), 'flag', 'primary', { id: id }) +
      popBtn('node-from', t('mp.node.from'), 'navigation', 'soft', { id: id }) +
      popBtn('node-pos', t('mp.ctx.set_pos'), 'crosshair', 'ghost', { id: id }) + '</div></div>';
  }
  function facPopup(id) {
    var f = facById(id);
    if (!f) return '';
    var d = S.pos ? R().haversineKm(S.pos, f) : null;
    var badges = [];
    if (f.night_shift) badges.push(NC.ui.badge(t('mp.med.night'), 'success', 'moon'));
    if (f.trauma_capable) badges.push(NC.ui.badge(t('mp.med.trauma'), 'danger', 'bandage'));
    if (f.is_stale) badges.push(NC.ui.badge(t('mk.stale'), 'warning', 'alert-triangle'));
    return '<div class="mp-pop"><p class="mp-pop__title">' + esc(f.name) + '</p>' +
      '<p class="mp-pop__meta">' + esc(t('mp.type.' + f.type)) + (d !== null ? ' · ' + esc(km(d)) : '') + ' · ' + esc(f.open_hours || '') + '</p>' +
      (badges.length ? '<div class="mp-pop__badges">' + badges.join('') + '</div>' : '') +
      '<div class="mp-pop__btns">' + popBtn('fac-dir', t('mp.med.directions'), 'navigation', 'primary', { id: id }) +
      (f.phone ? popBtn('call', t('common.call'), 'phone', 'soft', { phone: f.phone }) : '') + '</div></div>';
  }
  function svcPopup(id) {
    var s = svcById(id);
    if (!s) return '';
    return '<div class="mp-pop"><p class="mp-pop__title">' + esc(s.name) + '</p>' +
      '<p class="mp-pop__meta">' + esc(t('mp.type.' + s.type)) + (s.open_hours ? ' · ' + esc(s.open_hours) : '') + '</p>' +
      (s.is_partner ? '<div class="mp-pop__badges">' + NC.ui.badge(t('mp.stops.partner'), 'accent', 'star') + '</div>' : '') +
      '<div class="mp-pop__btns">' + popBtn('svc-dir', t('mp.med.directions'), 'navigation', 'primary', { id: id }) +
      (s.phone ? popBtn('call', t('common.call'), 'phone', 'soft', { phone: s.phone }) : '') + '</div></div>';
  }

  var ctxPopup = null;
  var ctxPoint = null;
  function onContext(e) {
    if (!S.graph || !e || !e.latlng) return;
    if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
    ctxPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
    var sn = R().snap(S.graph, ctxPoint);
    var html = '<div class="mp-pop"><p class="mp-pop__title">' + esc(t('mp.ctx.point')) + '</p>' +
      '<p class="mp-pop__meta mono">' + esc(coordText(ctxPoint)) + (sn ? ' · ' + esc(t('mp.ctx.off', { d: km(sn.distance_km) })) : '') + '</p>' +
      '<div class="mp-pop__btns mp-pop__btns--ctx">' +
      popBtn('ctx-pos', t('mp.ctx.set_pos'), 'crosshair', 'primary') +
      popBtn('ctx-to', t('mp.ctx.route_here'), 'flag', 'soft') +
      popBtn('ctx-from', t('mp.ctx.from_here'), 'navigation', 'soft') +
      popBtn('ctx-new', t('mp.ctx.propose'), 'plus', 'ghost') + '</div></div>';
    syncTopVar();
    ctxPopup = L().popup(popOpts({ maxWidth: 280, minWidth: 230 })).setLatLng(e.latlng).setContent(html).openOn(S.map);
  }
  function onPopupOpen(e) {
    var el = e && e.popup && e.popup.getElement ? e.popup.getElement() : null;
    if (el && !el._mpWired) { el._mpWired = true; el.addEventListener('click', onAction); }
  }

  /* ================================================================== map lifecycle */
  function ensureMap() {
    if (S.map) return true;
    if (!window.L || !NC.mapkit) { renderMapError(); return false; }
    try {
      var c = centerOf(S.routeId) || { lat: 23.05, lng: 105.15 };
      // the first view is provisional (the route / result fit follows once the panel is laid out): no raster tile is
      // requested before that fit — otherwise a whole tile set at the provisional zoom is fetched and thrown away (R5.3)
      var map = NC.mapkit.create(S.els.map, { center: [c.lat, c.lng], zoom: 9, zoomControl: false, holdTiles: true });
      S.tilesHeld = true;
      L().control.zoom({ position: 'bottomright', zoomInTitle: t('mp.zoom_in'), zoomOutTitle: t('mp.zoom_out') }).addTo(map);
      map.on('zoomend', syncZoomClass);
      map.on('dragstart zoomstart', onUserMove);
      map.on('resize', onMapResize); // fired by invalidateSize (mapkit's ResizeObserver) when the container size changed
      map.on('moveend resize', scheduleDeclutter); // overlays are fixed on screen: re-check labels/markers after any move
      map.on('contextmenu', onContext);
      map.on('click', onMapPick);
      map.on('popupopen', onPopupOpen);
      map.on('popupopen', function () { S.root.classList.add('mp-pop-open'); });
      map.on('popupclose', function () { S.root.classList.remove('mp-pop-open'); });
      S.map = map;
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { declutterLabels(); }); } catch (e) { /* no Font Loading API */ }
      // No overlapping POI markers / touch boxes at route zoom: the selected destination always stays; pharmacies
      // below zoom 10.5 are hidden by CSS (.mp-z-low) and so take no room.
      S.decl = NC.mapkit.declutter ? NC.mapkit.declutter(map, function () { return [S.lg.fac, S.lg.svc]; }, {
        keep: function (m) { return !!(S.to && (S.to.kind === 'fac' || S.to.kind === 'svc') && m.poi && S.to.id === m.poi.id); },
        skip: function (m) { return !!(m.poi && m.poi.type === 'nha_thuoc' && map.getZoom() < 10.5); }
      }) : null;
      // Offline vector basemap (downloaded corridors): drawn automatically when raster tiles are unavailable
      // (offline / blocked / failing) or on demand from the layers menu; place names already labelled by the route
      // nodes are skipped, labels keep clear of the floating controls. Whether a corridor covers the view is judged on
      // the area the fit padding leaves free (above the phone sheet), where fitBounds framed the route.
      if (NC.basemap && NC.basemap.attach) {
        S.bm = NC.basemap.attach(map, { mode: S.vbaseMode, skipPlace: dupPlace, obstacles: basemapObstacles, avoidLines: basemapAvoidLines, viewPadding: function () { return pads(); } });
        map.on('nc:vbase', renderLayers);
      }
      return true;
    } catch (e) {
      console.error('[map] create failed', e);
      renderMapError();
      return false;
    }
  }
  /* Boxes (map-container px) the offline basemap's labels keep clear of: floating controls, visible markers, node labels. */
  function basemapObstacles() {
    var ov = overlayRects();
    var boxes = ov ? ov.boxes.slice() : [];
    if (!S.els.map) return boxes;
    var mr = S.els.map.getBoundingClientRect();
    U.$$('.leaflet-marker-pane .leaflet-marker-icon, .leaflet-tooltip-pane .mp-label', S.els.map).forEach(function (el) {
      if (el.classList.contains('mk-poi-wrap--culled') || el.classList.contains('mp-label--culled') || el.classList.contains('mp-under')) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      boxes.push({ x: r.left - mr.left, y: r.top - mr.top, r: r.right - mr.left, b: r.bottom - mr.top });
    });
    return boxes;
  }
  /* Drawn route lines the offline basemap's labels keep off (half widths in px ≈ casing / 2 + 1). */
  function basemapAvoidLines() {
    var r = S.result, out = [];
    if (!r || !r.main || r.far || !S.map) return out;
    if (S.lg.route && S.map.hasLayer(S.lg.route) && r.main.an && r.main.an.geometry) out.push({ g: r.main.an.geometry, half: 7 });
    if (S.lg.alt && S.map.hasLayer(S.lg.alt) && r.other && r.other.an && r.other.an.geometry) out.push({ g: r.other.an.geometry, half: 5 });
    return out;
  }
  /* A basemap place label that duplicates a route node label (same name within 3 km) is left to the node. */
  function dupPlace(p) {
    if (!S.graph || !p || !p.name) return false;
    var nq = U.normalize(p.name);
    if (!nq) return false;
    return Object.keys(S.graph.nodes).some(function (id) {
      var n = S.graph.nodes[id];
      var nn = U.normalize(shortName(n.name || ''));
      return nn && (nn.indexOf(nq) >= 0 || nq.indexOf(nn) >= 0) && R().haversineKm(n, p) < 3;
    });
  }
  function renderMapError() {
    if (!S.els.map || S.els.map.getAttribute('data-err')) return;
    S.els.map.setAttribute('data-err', '1');
    S.els.map.appendChild(NC.ui.emptyState({ icon: 'map', variant: 'warning', title: t('app.title.map'), text: t('mp.error') }));
  }

  /* ================================================================== bottom panel (phones) */
  function tabbarH() {
    var tb = document.getElementById('tabbar');
    if (!tb) return 0;
    var cs = window.getComputedStyle ? window.getComputedStyle(tb) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return 0;
    return Math.round(tb.getBoundingClientRect().height);
  }
  /* How far the raised emergency button pokes above the tab bar (px; FAB_OVERHANG when it cannot be measured). */
  function fabOverhang() {
    var tb = document.getElementById('tabbar'), fab = document.getElementById('fab-emergency');
    if (!tb || !fab) return FAB_OVERHANG;
    var btn = fab.querySelector('.tabbar__fab-btn') || fab;
    var a = tb.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (!a.height || !b.height) return FAB_OVERHANG;
    return Math.max(0, Math.min(FAB_OVERHANG, Math.round(a.top - b.top)));
  }
  function metrics() {
    var H = S.root ? S.root.clientHeight : 0;
    var tab = tabbarH();
    var tabsH = S.els.tabs ? S.els.tabs.offsetHeight : 0;
    var topH = (S.els.ptop ? S.els.ptop.offsetHeight : 0) + tabsH;
    // at 'full' the route card replaces the summary (UX.7, map.css): the peek is still measured WITH it, the height
    // the sheet shows once it is back at peek
    var peekTop = topH;
    if (S.els.ptop && S.els.summary && !S.els.summary.offsetHeight && S.els.summary.firstChild) {
      S.root.classList.add('mp-sum-measure');
      peekTop = S.els.ptop.offsetHeight + tabsH;
      S.root.classList.remove('mp-sum-measure');
    }
    // peek = header + tabs, kept clear of the raised emergency button — only by its real overhang (+4 px), so no empty
    // strip shows under the tabs (UX.12)
    var fab = tab ? Math.min(FAB_OVERHANG, fabOverhang() + 4) : 0;
    var peek = Math.min(Math.max(80, H - 40), peekTop + tab + fab);
    var full = Math.max(peek, H - 6);
    var half = Math.min(full, Math.max(peek + 80, Math.round(H * 0.46 + tab * 0.3)));
    return { H: H, tab: tab, topH: topH, peek: peek, half: half, full: full };
  }
  function setPanelVars(vis, m) {
    var st = S.root.style;
    st.setProperty('--mp-panel-h', m.full + 'px');
    st.setProperty('--mp-y', (m.full - vis) + 'px');
    st.setProperty('--mp-occ', vis + 'px');
    st.setProperty('--mp-body-h', Math.max(0, m.full - m.topH) + 'px');
    st.setProperty('--mp-body-pad', Math.max(0, m.full - vis) + 'px');
  }
  function clearPanelVars() {
    ['--mp-panel-h', '--mp-y', '--mp-occ', '--mp-body-h', '--mp-body-pad'].forEach(function (k) { S.root.style.removeProperty(k); });
  }
  /* Snap a freshly entered phone sheet opens at: map first ('peek'), or 'half' when a route is on screen. */
  function entrySnap() { return S.result && S.result.main ? 'half' : 'peek'; }
  function applySnap(snap) {
    if (!S.root) return;
    var sheet = isSheet();
    // Crossing from the side panel (≥ 768 px, landscape) into the phone sheet — window resize, DevTools device
    // toolbar, tablet rotation — never keeps a stale snap: a 'full' sheet would cover the whole map (R5).
    if (sheet && S.sheetMode === false) snap = entrySnap();
    var crossed = S.sheetMode !== null && S.sheetMode !== sheet;
    S.sheetMode = sheet;
    if (SNAPS.indexOf(snap) >= 0) S.snap = snap;
    if (!sheet) {
      S.root.setAttribute('data-snap', 'side');
      clearPanelVars();
      S.m = null;
      syncTopVar();
      // phone sheet → side panel (rotation to landscape, window resize): the floating controls moved, so re-frame
      // the same target (e.g. from a 'full' sheet the old view would leave the route under the legend) — R5.4
      if (crossed && S.shown && S.autoFit && S.lastFit) {
        clearTimeout(S.snapFitT);
        S.snapFitT = setTimeout(function () { if (S.shown && S.autoFit && S.lastFit) S.lastFit(); }, 80);
      }
      return;
    }
    S.root.setAttribute('data-snap', S.snap);
    var m = S.m = metrics();
    if (!m.H) return;
    setPanelVars(m[S.snap], m);
    if (S.els.grip) S.els.grip.setAttribute('aria-expanded', S.snap === 'peek' ? 'false' : 'true');
    syncTopVar();
    scheduleDeclutter();
    // The sheet moved, so the free map area changed without a container resize: re-frame the same target unless
    // the user has panned/zoomed since the last automatic fit (e.g. a route result opens the sheet to "half").
    if (S.shown && S.autoFit && S.lastFit) {
      clearTimeout(S.snapFitT);
      S.snapFitT = setTimeout(function () { if (S.shown && S.autoFit && S.lastFit) S.lastFit(); }, 60);
    }
  }
  function cycleSnap() {
    applySnap(S.snap === 'peek' ? 'half' : S.snap === 'half' ? 'full' : 'peek');
  }
  function syncTopVar() {
    if (!S.els.top) return;
    S.root.style.setProperty('--mp-top-h', (S.els.top.offsetTop + S.els.top.offsetHeight + 10) + 'px');
    var p = pads();
    PAD_TL[0] = p.tl[0]; PAD_TL[1] = p.tl[1];
    PAD_BR[0] = p.br[0]; PAD_BR[1] = p.br[1];
  }

  /*
   * Phone bottom sheet: drag the header (grip + summary + tab row) with touch, pen or mouse; snaps to peek / half / full.
   * Moves and the release are read on window (capture phase), so the drag keeps following the pointer after it
   * leaves the header, and the child element that got the implicit touch capture losing it (when the header takes
   * the capture) cannot end the drag. A finished drag swallows the click that some engines (Firefox) then fire on
   * whatever ended up under the pointer. Tapping the grip (or Enter/Space on it) cycles the snap points.
   */
  function wireDrag() {
    var zone = S.els.ptop;
    if (!zone) return;
    var st = null;
    function begin(y, id, target) {
      if (!isSheet()) return;
      var inTabs = !!(target && target.closest && target.closest('.mp-tabs'));
      if (!inTabs && target && target.closest && target.closest('a, input, select, textarea, button:not(.mp-panel__grip)')) return;
      var m = S.m || metrics();
      // Taps on the grip / a tab keep their own click behaviour; only a tap on the summary cycles the snap here.
      var tapCycles = !inTabs && !(target && target.closest && target.closest('.mp-panel__grip'));
      st = { y: y, vis: m[S.snap], moved: false, id: id, cur: m[S.snap], trail: [{ y: y, t: Date.now() }], tapCycles: tapCycles };
    }
    function moveTo(y, e) {
      if (!st) return;
      var dy = y - st.y;
      if (!st.moved && Math.abs(dy) < 6) return;
      if (!st.moved) {
        st.moved = true;
        S.root.classList.add('is-dragging');
        // Keep receiving the pointer when it leaves the window (mouse). Moves are read on window anyway, so a
        // refused capture (synthetic or already-released pointer) is harmless.
        if (st.id !== undefined && zone.setPointerCapture) { try { zone.setPointerCapture(st.id); } catch (err) { /* ignore */ } }
      }
      var m = S.m || metrics();
      var vis = U.clamp(st.vis - dy, m.peek, m.full);
      st.cur = vis;
      setPanelVars(vis, m);
      st.trail.push({ y: y, t: Date.now() });
      if (st.trail.length > 6) st.trail.shift();
      if (e && e.cancelable) e.preventDefault();
    }
    function end(cancel) {
      if (!st) return;
      var s = st;
      st = null;
      S.root.classList.remove('is-dragging');
      if (s.id !== undefined && zone.releasePointerCapture) { try { zone.releasePointerCapture(s.id); } catch (err) { /* ignore */ } }
      if (!s.moved) {
        // A tap on the summary behaves like the grip (the grip's own click handles taps on it + keyboard).
        if (s.tapCycles && !cancel) cycleSnap();
        return;
      }
      S.suppressUntil = Date.now() + 450;
      var a = s.trail[0], b = s.trail[s.trail.length - 1];
      var v = b.t > a.t ? (a.y - b.y) / (b.t - a.t) : 0; // px/ms, up = positive
      var m = S.m || metrics();
      var target;
      if (Math.abs(v) > 0.45) {
        if (v > 0) target = SNAPS.filter(function (k) { return m[k] > s.cur + 1; })[0] || 'full';
        else target = SNAPS.slice().reverse().filter(function (k) { return m[k] < s.cur - 1; })[0] || 'peek';
      } else {
        target = SNAPS.reduce(function (best, k) { return Math.abs(m[k] - s.cur) < Math.abs(m[best] - s.cur) ? k : best; }, 'peek');
      }
      applySnap(target);
    }
    if (window.PointerEvent) {
      var onMove = function (e) { if (st && e.pointerId === st.id) moveTo(e.clientY, e); };
      var onUp = function (e) { if (st && e.pointerId === st.id) { unlisten(); end(e.type === 'pointercancel'); } };
      var listen = function () {
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
      };
      var unlisten = function () {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
      };
      var onDown = function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.isPrimary === false) return;
        if (st) { unlisten(); end(true); }
        begin(e.clientY, e.pointerId, e.target);
        if (st) listen();
      };
      // iOS Safari: no page rubber-band / pull-to-refresh while the sheet follows the finger.
      var noScroll = function (e) { if (st && st.moved && e.cancelable) e.preventDefault(); };
      // The tab row is part of the handle too: a finger landing near the summary's lower edge is often retargeted
      // onto a tab (touch adjustment); a vertical drag there moves the sheet, a tap still selects the tab.
      [zone, S.els.tabs].forEach(function (el) {
        if (!el) return;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('touchmove', noScroll, { passive: false });
      });
    } else {
      zone.addEventListener('touchstart', function (e) { if (e.touches[0]) begin(e.touches[0].clientY, undefined, e.target); }, { passive: true });
      zone.addEventListener('touchmove', function (e) { if (e.touches[0]) moveTo(e.touches[0].clientY, e); }, { passive: false });
      zone.addEventListener('touchend', function () { end(false); });
      zone.addEventListener('touchcancel', function () { end(true); });
      zone.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        begin(e.clientY, undefined, e.target);
        var mm = function (ev) { moveTo(ev.clientY, ev); };
        var mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); end(false); };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
    }
    zone.addEventListener('dragstart', function (e) { e.preventDefault(); }); // no native drag ghost (Chrome → pointercancel)
    // Swallow the click a finished drag produces; a new press starts a fresh gesture.
    S.root.addEventListener('pointerdown', function () { if (!st) S.suppressUntil = 0; }, true);
    S.root.addEventListener('click', function (e) {
      if (S.suppressUntil && Date.now() < S.suppressUntil) { S.suppressUntil = 0; e.preventDefault(); e.stopPropagation(); }
    }, true);
    S.els.grip.addEventListener('click', function () { cycleSnap(); });
    S.els.grip.addEventListener('keydown', function (e) {
      var i = SNAPS.indexOf(S.snap);
      if (e.key === 'ArrowUp') { e.preventDefault(); applySnap(SNAPS[Math.min(2, i + 1)]); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); applySnap(SNAPS[Math.max(0, i - 1)]); }
    });
  }

  /* ================================================================== tabs */
  function setTab(name, opts) {
    if (['route', 'med', 'stops', 'packs'].indexOf(name) < 0) name = 'route';
    var prev = S.tab;
    S.tab = name;
    U.$$('[role="tab"]', S.els.tabs).forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    U.$$('.mp-pane', S.root).forEach(function (p) { p.hidden = p.id !== 'mp-pane-' + name; });
    S.root.setAttribute('data-tab', name); // side panel: the route tab's own card replaces the header summary (map.css)
    if (S.els.body) S.els.body.scrollTop = 0;
    if (name === 'med') renderMed();
    if (name === 'stops') renderStops();
    if (name === 'packs') renderPacks();
    if (isSheet() && S.snap === 'peek' && !(opts && opts.keepSnap)) applySnap('half');
    else if (isSheet() && prev !== name && (prev === 'route' || name === 'route')) reflow(); // summary folds in / out (UX.7)
    if (!(opts && opts.silent)) persistUi();
  }

  /* ================================================================== renderers */
  function renderAll() {
    renderChips();
    renderSummary();
    renderPlanner();
    renderResult();
    if (S.tab === 'med') renderMed();
    if (S.tab === 'stops') renderStops();
    if (S.tab === 'packs') renderPacks();
    renderFar();
    reflow();
  }

  function renderChips() {
    var r = routeMeta(S.routeId);
    var name = r ? shortName(lang() === 'en' && r.name_en ? r.name_en : r.name) : S.routeId;
    var nameEl = S.els.routeName;
    if (nameEl) nameEl.textContent = name;
    if (S.els.routeChip) {
      S.els.routeChip.setAttribute('aria-label', t('mp.chip.route_aria', { name: name }));
      var iconBox = S.els.routeChip.querySelector('.mp-fchip__icon');
      if (iconBox) iconBox.innerHTML = ic(MODE_ICON[r && r.travel_mode] || 'route');
    }
    if (S.els.carrierName) S.els.carrierName.textContent = carrierName(S.carrier);
    var fabLabels = { locate: 'mp.fab.locate', fit: 'mp.fab.fit', 'layers-menu': 'mp.layers.btn', legend: 'mp.legend.btn' };
    U.$$('.mp-fab', S.root).forEach(function (b) {
      var k = fabLabels[b.getAttribute('data-mp')];
      if (k) { b.setAttribute('aria-label', t(k)); b.setAttribute('title', t(k)); }
    });
    renderLayers();
    renderDemo();
    syncTopVar();
  }

  /* ---------- layers menu ("Lớp bản đồ": Sóng / Y tế / Dịch vụ / Nền offline) ---------- */
  function vbaseState() {
    var bm = S.bm;
    var avail = bm ? bm.available() : [];
    return { avail: avail.length > 0, visible: !!(bm && bm.visible()), away: !!(bm && bm.away && bm.away()), mode: bm ? bm.mode() : 'auto', temp: !!(bm && bm.temporary && bm.temporary()) };
  }
  function renderLayers() {
    if (!S.root) return;
    U.$$('[data-layer]', S.root).forEach(function (b) {
      var k = b.getAttribute('data-layer');
      if (k !== 'vbase') b.setAttribute('aria-pressed', S.layers[k] ? 'true' : 'false');
    });
    var vb = S.root.querySelector('[data-layer="vbase"]');
    if (vb) {
      var s = vbaseState();
      vb.hidden = !NC.basemap;
      vb.setAttribute('aria-pressed', s.visible || (s.avail && s.mode === 'on') ? 'true' : 'false');
      var sub = vb.querySelector('.mp-lopt__sub');
      if (sub) sub.textContent = t(s.visible && s.temp ? 'mp.layers.vbase_temp' : !s.avail ? 'mp.layers.vbase_none' : s.visible ? 'mp.layers.vbase_on' : s.mode === 'off' ? 'mp.layers.vbase_off' : s.away ? 'mp.layers.vbase_away' : 'mp.layers.vbase_auto');
    }
    // a hidden optional layer is shown as a dot on the (closed) menu button, so nothing is "lost" behind the menu
    var btn = S.els.layersBtn;
    if (btn) btn.classList.toggle('has-off', !S.layers.signal || !S.layers.med);
  }
  function onMenuDown(e) {
    var p = S.els.layersPanel, b = S.els.layersBtn;
    if (!p || p.hidden) return;
    if ((p.contains && p.contains(e.target)) || (b && b.contains(e.target))) return;
    toggleLayers(false);
  }
  function onMenuKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var p = S.els.layersPanel;
    if (!p || p.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    toggleLayers(false);
    if (S.els.layersBtn) S.els.layersBtn.focus();
  }
  /* Keyboard focus leaving the menu (Tab past the last option, Shift+Tab before the button) closes it. */
  function onMenuFocusOut(e) {
    var p = S.els.layersPanel, b = S.els.layersBtn, to = e.relatedTarget;
    if (!p || p.hidden || !to) return; // no new target = window blur / pointer on a non-focusable spot (pointerdown handles it)
    if ((p.contains && p.contains(to)) || (b && (b === to || b.contains(to)))) return;
    toggleLayers(false);
  }
  function toggleLayers(open, viaKeyboard) {
    var btn = S.els.layersBtn, panel = S.els.layersPanel;
    if (!btn || !panel) return;
    var on = open === undefined ? panel.hidden : !!open;
    if (on === !panel.hidden) return;
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
    if (on) {
      toggleLegend(false);
      renderLayers();
      S.lmenuRel = NC.ui.onBack ? NC.ui.onBack(function () { S.lmenuRel = null; toggleLayers(false); }) : null;
      document.addEventListener('pointerdown', onMenuDown, true);
      document.addEventListener('keydown', onMenuKey, true);
      panel.addEventListener('focusout', onMenuFocusOut);
      btn.addEventListener('focusout', onMenuFocusOut);
      if (viaKeyboard) { var first = panel.querySelector('button:not([hidden])'); if (first) first.focus(); }
    } else {
      document.removeEventListener('pointerdown', onMenuDown, true);
      document.removeEventListener('keydown', onMenuKey, true);
      panel.removeEventListener('focusout', onMenuFocusOut);
      btn.removeEventListener('focusout', onMenuFocusOut);
      if (S.lmenuRel) { var rel = S.lmenuRel; S.lmenuRel = null; rel(); }
    }
    scheduleDeclutter();
  }
  /* Short landscape screens fold the signal legend behind a FAB (responsive.css): open it as a small popover. */
  function legendOpen() { return !!(S.root && S.root.classList.contains('mp-legend-open')); }
  function onLegendDown(e) {
    if (!legendOpen()) return;
    var lg = S.els.legend, b = S.els.legendBtn;
    if ((lg && lg.contains(e.target)) || (b && b.contains(e.target))) return;
    toggleLegend(false);
  }
  function onLegendKey(e) {
    if ((e.key !== 'Escape' && e.key !== 'Esc') || !legendOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleLegend(false);
    if (S.els.legendBtn) S.els.legendBtn.focus();
  }
  function toggleLegend(open) {
    var btn = S.els.legendBtn;
    if (!btn || !S.root) return;
    var on = open === undefined ? !legendOpen() : !!open;
    if (on === legendOpen()) return;
    S.root.classList.toggle('mp-legend-open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
    if (on) {
      toggleLayers(false);
      S.legRel = NC.ui.onBack ? NC.ui.onBack(function () { S.legRel = null; toggleLegend(false); }) : null;
      document.addEventListener('pointerdown', onLegendDown, true);
      document.addEventListener('keydown', onLegendKey, true);
    } else {
      document.removeEventListener('pointerdown', onLegendDown, true);
      document.removeEventListener('keydown', onLegendKey, true);
      if (S.legRel) { var rel = S.legRel; S.legRel = null; rel(); }
    }
    scheduleDeclutter();
  }
  function toggleVbase() {
    if (!S.bm) return;
    var s = vbaseState();
    if (!s.avail) {
      // nothing downloaded yet → the packs tab, where the corridors can be downloaded
      toggleLayers(false);
      S.focusBm = true;
      setTab('packs');
      return;
    }
    // on (shown, or explicitly on but outside the downloaded area) → off; otherwise → on
    S.vbaseMode = s.visible || s.mode === 'on' ? 'off' : 'on';
    persistUi();
    S.bm.setMode(S.vbaseMode).then(renderLayers);
  }

  /* ---------- "Chế độ demo" (collapsed disclosure at the end of the Route tab) ---------- */
  function renderDemo() {
    var el = S.els.demoStatus;
    if (!el) return;
    var sim = !!(S.pos && S.pos.source === 'sim');
    el.hidden = !sim;
    el.textContent = sim ? t('mp.pos.set', { name: placeLabel(S.pos) }) : '';
  }

  function lostLine(an) {
    var lost = an.lost_km > 0.05;
    return '<span class="mp-lostline' + (lost ? ' is-lost' : '') + '"><i class="signal-dot signal-dot--' + (lost ? 'lost' : 'likely') + '" aria-hidden="true"></i>' +
      esc(lost ? t('mp.sum.lost', { km: km(an.lost_km) }) : t('mp.sum.no_lost')) + '</span>';
  }

  function unknownKm(r) { return r && r.main ? (r.source === 'online' ? r.main.an.unknown_km || 0 : r.approach || 0) : 0; }
  /* Signal strip input: viz knows likely / uncertain / lost; 'unknown' is drawn with the muted token. Every stretch
     carries its localised level name (`label`) for the stretch tooltip. */
  var LEVEL_KEY = { likely: 'mp.legend.likely', uncertain: 'mp.legend.uncertain', lost: 'mp.legend.lost', unknown: 'mp.legend.unknown', muted: 'mp.legend.unknown' };
  function stripData(an) {
    if (!an || !an.parts) return an;
    return Object.assign({}, an, { parts: an.parts.map(function (p) {
      return Object.assign({}, p, { level: p.level === 'unknown' ? 'muted' : p.level, label: t(LEVEL_KEY[p.level] || 'mp.legend.unknown') });
    }) });
  }
  /* NC.viz.signalStrip titles each stretch with p.label (the legend's level name, e.g. "Chưa có dữ liệu sóng: 0 m – 137 km")
     instead of the colour token ("muted: …"). */
  function signalStrip(an, opts) { return NC.viz.signalStrip(stripData(an), opts); }
  function pathTitle() {
    return esc(shortName(fromLabel())) + ' <span class="mp-arrow" aria-hidden="true">→</span> ' + esc(shortName(destLabel(S.to)));
  }

  function renderSummary() {
    var el = S.els.summary;
    if (!el) return;
    var r = S.result;
    var title = r && (r.main || r.gate) ? pathTitle() : '';
    var gateMeta = r && r.gate && !r.fallback ? { pending: 'mp.on.sum_loading', consent: 'mp.on.sum_consent', net: 'mp.on.sum_net', error: 'mp.on.sum_err' }[r.gate] : null;
    if (gateMeta) {
      el.innerHTML = '<span class="icon-tile icon-tile--sm icon-tile--' + (r.gate === 'pending' || r.gate === 'consent' ? 'primary' : 'warning') + '">' + ic(r.gate === 'net' ? 'wifi-off' : 'globe') + '</span>' +
        '<div class="mp-summary__body"><p class="mp-summary__title">' + title + '</p>' +
        '<p class="mp-summary__meta mp-summary__meta--far">' + (r.gate === 'pending' ? '' : ic('alert-triangle')) + '<span>' + esc(t(gateMeta)) + '</span></p></div>';
    } else if (r && r.needFrom) {
      el.innerHTML = '<span class="icon-tile icon-tile--sm icon-tile--warning">' + ic('crosshair') + '</span>' +
        '<div class="mp-summary__body"><p class="mp-summary__title">' + esc(t('mp.res.need_from')) + '</p>' +
        '<p class="mp-summary__meta">' + esc(shortName(destLabel(S.to))) + '</p></div>';
    } else if (r && r.main) {
      var an = r.main.an, unk = unknownKm(r);
      el.innerHTML = '<span class="icon-tile icon-tile--sm icon-tile--solid">' + ic(r.source === 'online' ? 'globe' : STRAT_ICON[S.strategy]) + '</span>' +
        '<div class="mp-summary__body"><p class="mp-summary__title">' + title + '</p>' +
        '<p class="mp-summary__meta"><b>' + esc(km(r.total)) + '</b><span aria-hidden="true">·</span>' + esc(dur(etaMin(r.total))) + '<span aria-hidden="true">·</span>' +
        (an.lost_km <= 0.05 && unk > 0.3 ? '<span>' + esc(km(unk)) + ' ' + esc(t('mp.res.unknown').toLowerCase()) + '</span>' : lostLine(an)) +
        (r.approach > 0.3 ? '<span aria-hidden="true">·</span><span>' + esc(t('mp.res.approach', { d: km(r.approach) })) + '</span>' : '') + '</p>' +
        '<div class="mp-summary__strip" data-strip="peek"></div></div>';
      var box = el.querySelector('[data-strip="peek"]');
      if (box && NC.viz) box.appendChild(signalStrip(an, { height: 6 }));
    } else {
      // idle header = the sheet's intro line: no decorative icon tile (same rule as .page-intro)
      el.innerHTML = '<div class="mp-summary__body"><p class="mp-summary__title">' + esc(t('mp.sum.idle_title', { carrier: carrierName(S.carrier) })) + '</p>' +
        '<p class="mp-summary__meta">' + esc(t('mp.sum.idle_text')) + '</p></div>';
    }
    reflow();
  }

  /* Re-measure the phone panel after its header content changed (next frame, coalesced). */
  var reflowQueued = false;
  function reflow() {
    if (reflowQueued || !S.root) return;
    reflowQueued = true;
    requestAnimationFrame(function () { reflowQueued = false; applySnap(S.snap); });
  }

  function renderPlanner() {
    if (!S.els.from || !S.els.to) return;
    ['from', 'to'].forEach(function (w) {
      var c = S.cb[w];
      if (!c) return;
      if (document.activeElement !== c.input) c.input.value = fieldLabel(w);
      if (c.clear) c.clear.hidden = w === 'to' ? !S.to && !c.input.value : (S.from === 'me' && (document.activeElement !== c.input || !c.input.value));
    });
    if (S.segMode) S.segMode.set(S.mode);
    if (S.segStrat) S.segStrat.set(S.strategy);
    renderPresets();
    renderGeoHint();
  }

  /* One line under the planner about the location: blocked, not yet allowed, unavailable, or the demo rule. */
  function renderGeoHint() {
    var el = S.els.geoHint;
    if (!el) return;
    var G = NC.geo;
    var kept = G && G.demoKept ? G.demoKept() : null;
    var html = '';
    if (kept) {
      html = ic('crosshair') + '<span>' + esc(t('mp.geo.kept', { d: km(kept.km) })) + '</span>' +
        '<button class="btn btn--soft btn--sm" type="button" data-mp="geo-real">' + esc(t('geo.use_real')) + '</button>';
    } else if (S.geoPerm === 'denied') {
      html = ic('alert-circle') + '<span>' + esc(t('mp.geo.denied')) + '</span>';
    } else if (S.geoPerm === 'unsupported' && !S.pos) {
      html = ic('info') + '<span>' + esc(t('mp.geo.unsupported')) + '</span>';
    } else if (S.geoPerm === 'prompt' && !S.pos) {
      html = ic('locate') + '<span>' + esc(t('mp.geo.prompt')) + '</span>' +
        '<button class="btn btn--soft btn--sm" type="button" data-mp="geo-enable">' + esc(t('mp.geo.enable')) + '</button>';
    }
    el.hidden = !html;
    el.innerHTML = html;
  }
  function refreshGeoPerm() {
    if (!NC.geo || !NC.geo.permission) { S.geoPerm = 'unsupported'; renderGeoHint(); return; }
    NC.geo.permission().then(function (s) { S.geoPerm = s; renderGeoHint(); }).catch(function () { });
  }
  /* "Bật vị trí" (hint button, "Vị trí của tôi" option): the browser prompt from this tap, then route from the fix. */
  function enableGeo(btn, then) {
    var G = NC.geo;
    if (!G || !G.request) { toast(t('mp.gps.unsupported'), { type: 'warning' }); return; }
    if (btn) NC.ui.setLoading(btn, true);
    G.request().then(function (p) {
      if (btn && btn.isConnected !== false) NC.ui.setLoading(btn, false);
      refreshGeoPerm();
      if (!p) {
        toast(t(G.lastError && G.lastError() === 'denied' ? 'mp.gps.denied' : 'mp.gps.error'), { type: 'warning', timeout: 6000 });
        return;
      }
      if (G.demoKept && G.demoKept()) toast(t('geo.demo_kept', { d: km(G.demoKept().km), name: t('geo.sim_name') }), { type: 'info', timeout: 6000, action: { label: t('geo.use_real'), onClick: function () { G.useReal(); } } });
      setPos(p, { fly: !S.to, nosave: true });
      if (then) then(p);
    });
  }

  function renderPresets() {
    var box = S.els.presets;
    if (!box || !S.graph) return;
    var chips = ['<button class="chip chip--soft mp-preset mp-preset--care" type="button" data-mp="to-nearest">' + ic('cross') + '<span>' + esc(t('mp.plan.nearest_fac')) + '</span></button>'];
    // suggested trips only while no destination is set: with a trip on screen they would repeat the From / To fields
    // (the "nearest care" shortcut always stays); "Xoá lộ trình" brings them back
    if (!S.to) (PRESETS[S.routeId] || []).forEach(function (p) {
      var a = node(p[0]), b = node(p[1]);
      if (!a || !b) return;
      var on = S.from === p[0] && S.to && S.to.kind === 'node' && S.to.id === p[1];
      chips.push('<button class="chip mp-preset' + (on ? ' is-selected' : '') + '" type="button" data-mp="preset" data-from="' + esc(p[0]) + '" data-to="' + esc(p[1]) + '"' + (on ? ' aria-pressed="true"' : '') + '>' +
        '<span class="mp-preset__t"><span class="mp-preset__n">' + esc(shortName(nodeName(a))) + ' <span aria-hidden="true">→</span></span> <span class="mp-preset__n">' + esc(shortName(nodeName(b))) + '</span></span></button>');
    });
    box.innerHTML = chips.join('');
  }

  /* ---------- route result ---------- */
  /* Headline signal line: lost / uncertain / no-data km (likely is the rest of the strip). */
  function sigList(an, r) {
    var unk = unknownKm(r);
    // "Không mất sóng" only when the whole route has signal data; with no-data stretches it is "0 km mất sóng"
    var noLoss = an.lost_km <= 0.05 && unk <= 0.3;
    var items = [{ lv: 'lost', v: an.lost_km, label: noLoss ? t('mp.cmp.no_lost') : t('mp.legend.lost') }];
    if (an.uncertain_km > 0.05 || unk <= 0.05) items.push({ lv: 'uncertain', v: an.uncertain_km, label: t('mp.legend.uncertain') });
    if (unk > 0.05) items.push({ lv: 'unknown', v: unk, label: t('mp.res.unknown') });
    return '<ul class="mp-res__lv">' + items.map(function (it) {
      var zero = it.lv === 'lost' && noLoss;
      return '<li class="mp-res__lvi mp-res__lvi--' + it.lv + (zero ? ' is-zero' : it.v <= 0.05 ? ' is-none' : '') + '"><i class="mp-dot mp-dot--' + (zero ? 'likely' : it.lv) + '" aria-hidden="true"></i>' +
        (zero ? '' : '<b>' + esc(km(it.v)) + '</b>') + '<span>' + esc(it.label) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------- keyboard focus across route-card re-renders (WCAG 2.4.3) ----------
     renderResult() replaces #mp-result: the control that had focus gets it back (same data-mp / data-i / data-v, or
     the "Xem thêm" summary). After "Bắt đầu đi" / "Đang đi · Kết thúc" focus moves to the button that replaced it,
     also when NC.trip opened a dialog meanwhile (then once the dialog has closed and the page is interactive again). */
  var FOCUS_SWAP = { 'trip-start': 'trip-stop', 'trip-stop': 'trip-start' };
  function resultFocusKey(box) {
    var a = document.activeElement;
    if (!a || a === document.body || !box.contains(a)) return null;
    if (a.getAttribute('data-mp')) return { mp: a.getAttribute('data-mp'), i: a.getAttribute('data-i'), v: a.getAttribute('data-v') };
    if (a.tagName === 'SUMMARY' && a.parentNode && a.parentNode.id === 'mp-more') return { summary: true };
    return null;
  }
  function resultFocusTarget(box, k) {
    if (k.summary) return box.querySelector('#mp-more > summary');
    var same = '[data-mp="' + k.mp + '"]' + (k.i !== null && k.i !== undefined ? '[data-i="' + k.i + '"]' : '') + (k.v !== null && k.v !== undefined ? '[data-v="' + k.v + '"]' : '');
    var swap = FOCUS_SWAP[k.mp] ? box.querySelector('[data-mp="' + FOCUS_SWAP[k.mp] + '"]') : null;
    return k.swap ? swap || box.querySelector(same) : box.querySelector(same) || swap;
  }
  function focusLost() { var a = document.activeElement; return !a || a === document.body || !document.contains(a); }
  function tryFocus(el) {
    if (!el || !document.contains(el) || (NC.ui.openCount && NC.ui.openCount() > 0)) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    return document.activeElement === el;
  }
  function restoreResultFocus(box, k) {
    clearInterval(S.focusT);
    if (!k || !S.shown) return;
    var target = resultFocusTarget(box, k);
    if (!target) { if (k.swap) S.focusIntent = null; return; }
    if (tryFocus(target)) { if (k.swap) S.focusIntent = null; return; }
    if (!k.swap) return;
    // a dialog opened by NC.trip (or the inert background while it closes): wait, then focus if nobody took it
    var until = Date.now() + 20000;
    S.focusT = setInterval(function () {
      if (!S.focusIntent || !S.shown || Date.now() > until) { clearInterval(S.focusT); S.focusIntent = null; return; }
      if (NC.ui.openCount && NC.ui.openCount() > 0) return;
      if (!focusLost()) { clearInterval(S.focusT); S.focusIntent = null; return; }
      var el = S.els.result ? resultFocusTarget(S.els.result, { mp: S.focusIntent, swap: true }) : null;
      if (!el || tryFocus(el)) { clearInterval(S.focusT); S.focusIntent = null; }
    }, 200);
  }

  function renderResult() {
    var box = S.els.result;
    if (!box) return;
    var fk = S.focusIntent ? { mp: S.focusIntent, swap: true } : resultFocusKey(box);
    renderResultBody(box);
    // a route card / online state / "choose a start" card is on the route tab → the header summary that would repeat
    // it (route name, numbers, strip — UX.7) folds away: side panel always, phone sheet at 'full' (map.css)
    var r = S.result, card = !!(S.graph && r && (r.main || r.gate || r.needFrom));
    if (S.root && S.root.classList.contains('mp-has-card') !== card) {
      S.root.classList.toggle('mp-has-card', card);
      if (isSheet()) reflow(); // the sheet header changed height
    }
    if (fk && (fk.swap || focusLost())) restoreResultFocus(box, fk);
  }
  function renderResultBody(box) {
    var r = S.result;
    if (!S.graph) {
      box.innerHTML = '<div class="card mp-idle"><span class="skeleton skeleton--circle"></span><div class="stack--sm stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div></div>';
      return;
    }
    if (!r) { box.innerHTML = idleHtml(); return; }
    if (r.none) {
      box.innerHTML = '';
      box.appendChild(NC.ui.emptyState({ icon: 'route', variant: 'warning', title: t('mp.res.none_title'), text: t(r.netHint ? 'mp.res.none_text_net' : 'mp.res.none_text') }));
      return;
    }
    if (r.needFrom) {
      box.innerHTML = '<div class="card mp-gate" role="status"><span class="icon-tile icon-tile--warning">' + ic('crosshair') + '</span>' +
        '<div class="mp-gate__main"><h2 class="mp-gate__title">' + esc(t('mp.res.need_from')) + '</h2>' +
        '<p class="mp-gate__text">' + esc(t('mp.res.need_from_text')) + '</p>' +
        '<div class="mp-gate__actions"><button class="btn btn--primary btn--sm" type="button" data-mp="need-from">' + ic('search') + '<span>' + esc(t('mp.plan.from_ph').replace(/…$/, '')) + '</span></button></div></div></div>';
      return;
    }
    var html = r.gate ? gateHtml(r) : '';
    if (r.main && !r.far) html += resultHtml(r);
    if (!html) html = idleHtml();
    box.innerHTML = html;
    if (r.main && !r.far) {
      var an = r.main.an;
      var main = box.querySelector('[data-strip="main"]');
      if (main && NC.viz) main.appendChild(signalStrip(an, { height: 12, showKm: true, pois: (r.stops || []).filter(function (s) { return CARE_TYPES.indexOf(s.poi.type) >= 0; }) }));
      ['shortest', 'signal'].forEach(function (k) {
        var el = box.querySelector('[data-strip="cmp-' + k + '"]');
        if (el && r.paths[k] && NC.viz) el.appendChild(signalStrip(r.paths[k].an, { height: 8 }));
      });
      var more = box.querySelector('#mp-more');
      if (more) more.addEventListener('toggle', function () { S.moreOpen = more.open; });
    }
  }

  /* The route card (R1): headline, dead-zone summary, "Bắt đầu đi" + "Gửi vị trí", everything else under "Xem thêm". */
  function resultHtml(r) {
    var an = r.main.an;
    var total = r.total;
    var online = r.source === 'online';
    var via = online ? [] : viaList(an, 3);
    var notes = [];
    if (r.gate && r.fallback) notes.push(t('mp.on.fallback'));
    if (r.startOff > 0.3) notes.push(t(S.from === 'me' ? 'mp.res.off_start' : 'mp.res.off_start_pt', { d: km(r.startOff) }));
    if (S.to && S.to.kind !== 'node' && r.endOff > 0.15) notes.push(t(S.to.kind === 'fac' || S.to.kind === 'svc' ? 'mp.res.off_end' : 'mp.res.off_end_pt', { d: km(r.endOff) }));
    if (r.netHint) notes.push(t('mp.on.hint_net'));
    if (online && an.unknown_km > 0.05) notes.push(t('mp.on.unknown_note'));
    var html = '<article class="card mp-res" aria-labelledby="mp-sum-title">' +
      '<h2 class="mp-res__path" id="mp-sum-title">' + pathTitle() + '</h2>' +
      (via.length ? '<p class="mp-res__via">' + esc(t('mp.res.via', { list: via.join(', ') })) + '</p>' : '') +
      '<p class="mp-res__nums"><b>' + esc(km(total)) + '</b>' +
      '<span class="mp-res__eta" title="' + esc(t('mp.res.speed', { mode: t('mp.mode.' + S.mode), v: num(speedOf(S.mode), S.mode === 'hiking' ? 1 : 0) })) + '">' + ic('clock') + esc(dur(etaMin(total))) + '</span>' +
      '<span class="mp-res__mode">' + ic(MODE_ICON[S.mode]) + esc(t('mp.mode.' + S.mode)) + '</span></p>' +
      '<div class="mp-res__strip" data-strip="main"></div>' + sigList(an, r) +
      notes.map(function (n) { return '<p class="mp-res__note">' + ic('info') + '<span>' + esc(n) + '</span></p>'; }).join('') +
      (online ? '<p class="mp-res__src">' + ic('globe') + '<span>' + esc(t('mp.on.source')) + '</span></p>' : '') +
      dzHtml(an, r) + tripCta(r) + moreHtml(r) +
      '</article>';
    html += '<div class="mp-actions"><button class="btn btn--ghost btn--sm" type="button" data-mp="speak">' + ic(S.speaking ? 'volume-off' : 'volume') +
      '<span>' + esc(t(S.speaking ? 'mp.act.stop' : 'mp.act.speak')) + '</span></button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-mp="clear-route">' + ic('x') + '<span>' + esc(t('mp.act.clear')) + '</span></button></div>';
    return html;
  }

  function moreHtml(r) {
    var online = r.source === 'online';
    var inner = '';
    if (online) inner += '<p class="mp-note">' + ic('info') + '<span>' + esc(t('mp.on.single')) + '</span></p>';
    else if (r.other && !r.same) inner += compareHtml(r);
    else if (r.other) inner += '<p class="mp-note mp-note--ok">' + ic('check-circle') + '<span>' + esc(t('mp.res.same', { carrier: carrierName(S.carrier) })) + '</span></p>';
    inner += partsHtml(r.main.an) + alongHtml(r);
    // shared disclosure (components.css .disclosure), bleeding to the card edges (.mp-more)
    return '<details class="disclosure mp-more" id="mp-more"' + (S.moreOpen ? ' open' : '') + '><summary class="disclosure__sum mp-more__sum">' + ic('info') +
      '<span class="disclosure__txt"><span class="disclosure__title">' + esc(t('mp.res.more')) + '</span><span class="disclosure__sub">' + esc(t(online ? 'mp.res.more_sub_on' : 'mp.res.more_sub')) + '</span></span>' +
      '<span class="disclosure__chev">' + ic('chevron-down') + '</span></summary><div class="disclosure__body mp-more__body">' + inner + '</div></details>';
  }

  /* Primary "Bắt đầu đi" (NC.trip, C2) / "Đang đi · Kết thúc" for this trip; secondary "Gửi vị trí". */
  function currentTrip() { try { return NC.trip && NC.trip.current ? NC.trip.current() : null; } catch (e) { return null; } }
  function tripCta(r) {
    var plan = r.plan || (r.plan = buildPlan(r));
    var tr = currentTrip();
    var mine = !!(tr && plan && tr.route_key === plan.route_key);
    var th = R().THRESHOLDS[S.mode] || R().THRESHOLDS.motorbike;
    var hint = tr && !mine ? t('mp.trip.other', { from: tr.from_label || '…', to: tr.to_label || '…' }) :
      !mine && r.main.an.zones.length ? t('mp.trip.hint', { min: th.minutes, mode: t('mp.mode.' + S.mode).toLowerCase() }) : '';
    return '<div class="mp-res__cta">' +
      (mine ? '<button class="btn btn--primary btn--block mp-trip is-on" type="button" data-mp="trip-stop">' + ic('flag') + '<span>' + esc(t('mp.trip.stop')) + '</span></button>'
        : '<button class="btn btn--primary btn--block mp-trip" type="button" data-mp="trip-start">' + ic('navigation') + '<span>' + esc(t('mp.trip.start')) + '</span></button>') +
      '<button class="btn btn--outline btn--block" type="button" data-mp="trip-share">' + ic('send') + '<span>' + esc(t('mp.trip.share')) + '</span></button></div>' +
      (hint ? '<p class="mp-res__hint">' + ic(tr && !mine ? 'info' : 'bell') + '<span>' + esc(hint) + '</span></p>' : '');
  }

  function idleHtml() {
    return '<article class="card mp-idle">' +
      '<div class="mp-idle__body"><h2 class="card__title">' + esc(t('mp.res.empty_title')) + '</h2>' +
      '<p class="card__subtitle">' + esc(t('mp.res.empty_text', { carrier: carrierName(S.carrier) })) + '</p></div></article>';
  }

  /* Online states above (or instead of) the route card: consent, loading, failed, no connection. */
  function gateHtml(r) {
    var a = r.a, b = r.b;
    var air = a && b ? km(R().haversineKm(a, b)) : null;
    var path = '<p class="mp-gate__path">' + pathTitle() + '</p>';
    // the simulated position is a demo tool (R1): offered here only in the demo (?demo=1), else in "Chế độ demo"
    var simBtn = S.from === 'me' && !r.fallback && isDemo() ? '<button class="btn btn--ghost btn--sm" type="button" data-mp="sim">' + ic('crosshair') + '<span>' + esc(t('mp.pos.far_btn')) + '</span></button>' : '';
    var clearBtn = r.fallback ? '' : '<button class="btn btn--ghost btn--sm" type="button" data-mp="clear-route">' + ic('x') + '<span>' + esc(t('mp.act.clear')) + '</span></button>';
    function card(tone, icon, title, text, actions, extra) {
      return '<div class="card mp-gate mp-gate--' + tone + '" role="status"' + (extra || '') + '><span class="icon-tile icon-tile--' + (tone === 'busy' ? 'primary' : tone) + '">' + ic(icon) + '</span>' +
        '<div class="mp-gate__main"><h2 class="mp-gate__title">' + esc(title) + '</h2>' + (r.fallback ? '' : path) +
        (text ? '<p class="mp-gate__text">' + esc(text) + '</p>' : '') +
        (actions ? '<div class="mp-gate__actions">' + actions + '</div>' : '') + '</div></div>';
    }
    if (r.gate === 'pending') return card('busy', 'globe', t('mp.on.loading'), '', '', ' aria-busy="true"').replace('</h2>', '</h2><span class="mp-gate__bar" aria-hidden="true"></span>');
    if (r.gate === 'consent') {
      return card('primary', 'globe', t('mp.on.consent_title'), t('mp.on.consent_text'),
        '<button class="btn btn--primary btn--sm" type="button" data-mp="online-ok">' + ic('check') + '<span>' + esc(t('mp.on.consent_ok')) + '</span></button>' + simBtn + clearBtn);
    }
    if (r.gate === 'error') {
      return card('warning', 'alert-triangle', t('mp.on.err_title'), t('mp.on.err_text', { why: t('mp.err.' + (r.err || 'http')) }),
        '<button class="btn btn--primary btn--sm" type="button" data-mp="online-retry">' + ic('refresh') + '<span>' + esc(t('mp.on.retry')) + '</span></button>' + simBtn + clearBtn);
    }
    // 'net': offline and farther than FAR_KM from every pilot route
    var text = air ? t('mp.on.net_text', { to: shortName(destLabel(S.to)), from: S.from === 'me' ? t('mp.far.you') : shortName(fromLabel()), air: air }) : '';
    return card('warning', 'wifi-off', t('mp.on.net_title'), text, simBtn +
      '<button class="btn btn--ghost btn--sm" type="button" data-mp="fit">' + ic('map-pin') + '<span>' + esc(t('mp.dz.show')) + '</span></button>' + clearBtn);
  }

  /* Dead-zone summary inside the route card. */
  function dzHtml(an, r) {
    var lead = r && r.startOff > 0.3 ? r.startOff : 0; // off-network approach before the analysed path starts
    if (!an.zones || !an.zones.length) {
      // stretches without signal data: neutral tone (never the green "has signal" look, R4)
      var unk = unknownKm(r) > 0.3;
      return '<div class="mp-dz ' + (unk ? 'mp-dz--unknown' : 'mp-dz--ok') + '"><span class="mp-dz__icon">' + ic(unk ? 'help-circle' : 'signal') + '</span><div class="mp-dz__main">' +
        '<h3 class="mp-dz__title">' + esc(t(unk ? 'mp.dz.none_known' : 'mp.dz.none_title')) + '</h3>' +
        '<p class="mp-dz__text">' + esc(unk ? t('mp.dz.none_known_text') : t('mp.dz.none_text', { carrier: carrierName(S.carrier) })) + '</p></div></div>';
    }
    var dz = R().deadzoneAhead(an, 0, { mode: S.mode });
    var z = an.zones[0];
    var th = R().THRESHOLDS[S.mode] || R().THRESHOLDS.motorbike;
    var longest = an.zones.reduce(function (m, x) { return Math.max(m, x.length_km); }, 0);
    var inZone = dz.in_deadzone && !lead;
    var zx = lead + (dz.in_deadzone ? 0 : z.start_km);
    var soon = inZone || (lead ? (etaMin(zx) <= th.minutes || zx <= th.km) : dz.should_warn);
    var title = inZone ? t('mp.dz.title_now', { y: km(z.end_km) }) :
      t('mp.dz.title', { x: km(zx), t: dur(etaMin(zx)), y: km(dz.in_deadzone ? z.end_km : z.length_km) });
    var sub = an.zones.length > 1 ? t('mp.dz.zones', { n: an.zones.length, max: km(longest) }) : '';
    return '<div class="mp-dz ' + (soon ? 'mp-dz--danger' : 'mp-dz--warn') + '" role="status">' +
      '<span class="mp-dz__icon">' + ic('wifi-off') + '</span>' +
      '<div class="mp-dz__main"><h3 class="mp-dz__title">' + esc(title) + '</h3>' +
      (soon ? '<p class="mp-dz__soon">' + ic('alert-triangle') + esc(t('mp.dz.soon')) + '</p>' : '') +
      (sub ? '<p class="mp-dz__text">' + esc(sub) + '</p>' : '') +
      '<button class="btn btn--ghost btn--sm mp-dz__show" type="button" data-mp="zone" data-i="0">' + ic('map-pin') + '<span>' + esc(t('mp.dz.show')) + '</span></button>' +
      '</div></div>';
  }

  function compareHtml(r) {
    var sh = r.paths.shortest, sg = r.paths.signal;
    function opt(p) {
      var an = p.an;
      var on = p.strategy === S.strategy;
      var via = viaList(an, 2);
      var lost = an.lost_km > 0.05;
      return '<button class="mp-cmp__opt' + (on ? ' is-selected' : '') + '" type="button" data-mp="strategy" data-v="' + p.strategy + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="mp-cmp__name">' + ic(STRAT_ICON[p.strategy]) + esc(t('mp.strategy.' + p.strategy)) + '</span>' +
        (on ? '<span class="mp-cmp__check" title="' + esc(t('mp.cmp.in_use')) + '">' + ic('check-circle') + '</span>' : '') +
        '<span class="mp-cmp__km">' + esc(km(an.length_km + (r.approach || 0))) + '</span>' +
        '<span class="mp-cmp__eta">' + esc(dur(etaMin(an.length_km + (r.approach || 0)))) + '</span>' +
        '<span class="mp-cmp__strip" data-strip="cmp-' + p.strategy + '"></span>' +
        '<span class="mp-cmp__lost' + (lost ? '' : ' is-ok') + '"><i class="signal-dot signal-dot--' + (lost ? 'lost' : 'likely') + '" aria-hidden="true"></i>' +
        esc(lost ? t('mp.cmp.lost', { km: km(an.lost_km) }) : t('mp.cmp.no_lost')) + '</span>' +
        (via.length ? '<span class="mp-cmp__via">' + esc(t('mp.res.via', { list: via.join(', ') })) + '</span>' : '') +
        '</button>';
    }
    var dk = sg.an.length_km - sh.an.length_km;
    var dl = sh.an.lost_km - sg.an.lost_km;
    var verdict = '';
    if (dl > 0.05) {
      verdict = dk > 0.05 ? t('mp.cmp.verdict', { dk: km(dk), dt: dur(etaMin(dk)), dl: km(dl), p: '−' + pct(dl, sh.an.lost_km) })
        : t('mp.cmp.verdict_free', { dl: km(dl) });
    }
    return '<section class="mp-sec mp-cmp"><header class="mp-sec__head"><div><h3 class="mp-sec__title">' + esc(t('mp.cmp.title')) + '</h3>' +
      '<p class="mp-sec__sub">' + esc(t('mp.cmp.sub')) + '</p></div></header>' +
      '<div class="mp-cmp__grid">' + opt(sh) + opt(sg) + '</div>' +
      (verdict ? '<p class="mp-cmp__verdict">' + ic('sparkles') + '<span>' + esc(verdict) + '</span></p>' : '') + '</section>';
  }

  function partsHtml(an) {
    var parts = an.parts || [];
    var LIMIT = 6;
    var list = S.partsOpen ? parts : parts.slice(0, LIMIT);
    // 'unknown' (no signal data, online routes) has no shared signal badge: a neutral one with the grey dash-dot dot
    var badge = function (lv) {
      return lv === 'unknown' ? '<span class="badge badge--neutral mp-badge-unknown"><i class="mp-dot mp-dot--unknown" aria-hidden="true"></i><span>' + esc(t('mp.legend.unknown')) + '</span></span>' : NC.ui.signalBadge(lv);
    };
    return '<section class="mp-sec mp-parts-card"><header class="mp-sec__head"><h3 class="mp-sec__title">' + esc(t('mp.parts.title')) + '</h3>' +
      NC.ui.badge(t('mp.parts.count', { n: parts.length }), 'neutral') + '</header>' +
      '<ol class="mp-parts">' + list.map(function (p) {
        return '<li class="mp-part mp-part--' + p.level + '"><span class="mp-part__bar" aria-hidden="true"></span>' +
          '<span class="mp-part__km">' + esc(t('mp.parts.km', { a: num(p.from_km, 1), b: num(p.to_km, 1) })) + '<small>' + esc(km(p.to_km - p.from_km)) + '</small></span>' +
          badge(p.level) + '</li>';
      }).join('') + '</ol>' +
      (parts.length > LIMIT ? '<button class="btn btn--ghost btn--sm btn--block mp-parts__more" type="button" data-mp="parts-more">' + ic(S.partsOpen ? 'chevron-up' : 'chevron-down') +
        '<span>' + esc(S.partsOpen ? t('mp.parts.less') : t('mp.parts.more', { n: parts.length })) + '</span></button>' : '') + '</section>';
  }

  function stopItem(s, opts) {
    var p = s.poi;
    var fac = isFac(p);
    var meta = [t('mp.type.' + p.type)];
    if (s.along_km !== undefined) meta.push(t('mp.along.at', { km: num(s.along_km, 1) }));
    if (s.off_km !== undefined && s.off_km > 0.05) meta.push(t('mp.along.off', { d: km(s.off_km) }));
    if (s.dist_km !== undefined) meta.push(km(s.dist_km));
    if (p.open_hours) meta.push(p.open_hours);
    var act = fac ? 'fac-dir' : 'svc-dir';
    return '<div class="list-item mp-stop">' + sheetIconTile(p.type) +
      '<span class="list-item__body"><span class="list-item__title">' + esc(p.name) + '</span>' +
      '<span class="list-item__meta"><span>' + esc(meta.join(' · ')) + '</span>' +
      (p.is_partner ? NC.ui.badge(t('mp.stops.partner'), 'accent', 'star') : '') + (p.is_stale ? NC.ui.badge(t('mk.stale'), 'warning') : '') + '</span></span>' +
      '<span class="list-item__trail">' +
      (p.phone && !(opts && opts.noCall) ? '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-call="' + esc(p.phone) + '" aria-label="' + esc(t('common.call') + ' ' + p.name) + '">' + ic('phone') + '</button>' : '') +
      '<button class="btn btn--soft btn--icon btn--sm" type="button" data-mp="' + act + '" data-id="' + esc(p.id) + '" aria-label="' + esc(t('mp.med.directions') + ': ' + p.name) + '">' + ic('navigation') + '</button>' +
      '</span></div>';
  }

  function alongHtml(r) {
    var list = r.stops || [];
    var head = '<header class="mp-sec__head"><h3 class="mp-sec__title">' + esc(t('mp.along.title', { km: km(BUFFER_KM) })) + '</h3>' +
      (list.length ? '<button class="section-head__action" type="button" data-mp="tab" data-tab="stops">' + esc(t('mp.along.all')) + ic('chevron-right') + '</button>' : '') + '</header>';
    if (!list.length) return '<section class="mp-sec mp-along">' + head + '<p class="muted small">' + esc(t('mp.along.none', { km: km(BUFFER_KM) })) + '</p></section>';
    var care = list.filter(function (s) { return CARE_TYPES.indexOf(s.poi.type) >= 0; });
    var rest = list.filter(function (s) { return CARE_TYPES.indexOf(s.poi.type) < 0; });
    var pick = care.slice(0, 3).concat(rest.slice(0, Math.max(1, 4 - Math.min(3, care.length))));
    pick.sort(function (a, b) { return a.along_km - b.along_km; });
    return '<section class="mp-sec mp-along">' + head + '<div class="list mp-stops">' + pick.map(function (s) { return stopItem(s); }).join('') + '</div></section>';
  }

  /* ---------- nearest medical ---------- */
  function originPoint() { return S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : fromLatLng(); }
  function posLine(prefixKey) {
    var o = originPoint();
    if (!o) {
      return '<div class="mp-pos mp-pos--none">' + ic('crosshair') + '<span>' + esc(t('mp.pos.none')) + '</span>' +
        '<button class="btn btn--soft btn--sm" type="button" data-mp="sim">' + esc(t('mp.fab.sim')) + '</button></div>';
    }
    var src = S.pos ? (S.pos.source === 'gps' ? t('mp.pos.gps') : t('mp.pos.sim')) : shortName(fromLabel());
    return '<div class="mp-pos"><span class="mp-pos__dot" aria-hidden="true"></span><span class="mp-pos__text"><small>' + esc(t(prefixKey || 'mp.pos.from')) + '</small>' +
      '<b>' + esc(placeLabel(o)) + '</b><span class="badge badge--neutral">' + esc(src) + '</span></span>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-mp="sim">' + ic('crosshair') + '<span>' + esc(t('mp.pos.change')) + '</span></button></div>';
  }

  function renderMedFilter() {
    var box = S.els.medFilter;
    if (!box) return;
    var types = ['all'].concat(FAC_TYPES);
    box.innerHTML = types.map(function (ty) {
      var on = S.medType === ty;
      return '<button class="chip' + (on ? ' is-selected' : '') + '" type="button" data-mp="med-type" data-type="' + ty + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (ty === 'all' ? '' : ic(NC.mapkit ? NC.mapkit.iconFor(ty) : 'cross')) + '<span>' + esc(ty === 'all' ? t('mp.med.all') : t('mp.type.' + ty)) + '</span></button>';
    }).join('') +
      '<button class="chip' + (S.traumaOnly ? ' is-selected' : '') + '" type="button" data-mp="med-trauma" aria-pressed="' + (S.traumaOnly ? 'true' : 'false') + '">' + ic('bandage') + '<span>' + esc(t('mp.med.trauma_only')) + '</span></button>';
    syncFade(box);
  }
  /* .scroll-fade-x: the faded right edge says "more →" until the row is scrolled to its end (or does not overflow). */
  function syncFade(el) {
    if (!el) return;
    el.classList.toggle('is-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }

  function renderMed() {
    var box = S.els.medList;
    if (!box) return;
    var gen = ++S.medGen;
    renderMedFilter();
    if (S.els.medPos) S.els.medPos.innerHTML = posLine();
    // medical content → the compact medical note (still with 115); the route tab carries none (not medical content)
    if (S.els.medDisc && !S.els.medDisc.firstChild) S.els.medDisc.appendChild(NC.ui.disclaimer({ compact: true }));
    var o = originPoint();
    if (!o || !NC.data) { box.innerHTML = ''; return; }
    if (!box.firstChild) box.innerHTML = '<div class="skeleton skeleton--card"></div><div class="skeleton skeleton--card"></div>';
    var types = S.medType === 'all' ? CARE_TYPES : [S.medType];
    NC.data.nearestFacilities(o, { limit: 60, types: types }).then(function (list) {
      if (gen !== S.medGen) return;
      list = (list || []).filter(function (f) { return !S.traumaOnly || f.trauma_capable; });
      var rk = rankCare(o, list, { k: 8 });
      var rows = rk.list.slice(0, 8);
      if (!rows.length) {
        box.innerHTML = '';
        box.appendChild(NC.ui.emptyState({ icon: 'cross', title: t('mp.med.empty'), compact: true }));
        return;
      }
      box.innerHTML = '<h2 class="visually-hidden">' + esc(t('mp.plan.nearest_fac')) + '</h2>' +
        (rk.far ? '<p class="mp-note mp-note--warn">' + ic('alert-triangle') + '<span>' + esc(t('mp.med.far', { d: km(rk.far) })) + '</span></p>' : '') +
        rows.map(function (r, i) { return facCard(r.f, r.road, { first: i === 0, pick: i > 0 && r === rk.pick, far: !!rk.far }); }).join('');
    }).catch(function () { if (gen === S.medGen) box.innerHTML = ''; });
  }

  /**
   * Road trip o → f on the pack graph (shortest), including the straight off-network legs at both ends.
   * @returns {{km:number, off:number, an:Object}|null} null when no road links them in the packs.
   */
  function roadTo(o, f) {
    if (!S.graph) return null;
    try {
      var p = R().routeBetween(S.graph, o, { lat: f.lat, lng: f.lng }, { strategy: 'shortest' });
      if (!p) return null;
      var sOff = p.start ? p.start.distance_km : 0, eOff = p.end ? p.end.distance_km : 0;
      if (sOff > FAR_KM || eOff > FAR_KM) return null; // not a road trip any more
      var an = R().analyze(S.graph, p);
      return { km: p.length_km + sOff + eOff, off: sOff + eOff, an: an };
    } catch (e) { return null; }
  }

  /** Opening hours vs the device clock: '24/7' or 'HH:MM–HH:MM' (overnight ranges ok). null = unknown. */
  function openNow(f, now) {
    var h = String((f && f.open_hours) || '').trim();
    if (!h) return null;
    if (/24\s*\/\s*(7|24)/.test(h)) return true;
    var m = /(\d{1,2})[:h.](\d{2})\s*[–—-]\s*(\d{1,2})[:h.](\d{2})/.exec(h);
    if (!m) return null;
    var d = now || new Date();
    var cur = d.getHours() * 60 + d.getMinutes();
    var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);
  }
  function is247(f) { return /24\s*\/\s*(7|24)/.test(String((f && f.open_hours) || '')); }
  /* Reachable right now: inside opening hours, or staffed at night ("trực đêm"). */
  function availableNow(f) { var o = openNow(f); return o === true || !!f.night_shift ? true : o; }
  /* Capability score for the "recommended" pick: available now > unknown hours > closed, trauma care, recently verified. */
  function careScore(f) { var o = availableNow(f); return (o === true ? 2 : o === null ? 1 : 0) + (f.trauma_capable ? 1 : 0) + (f.is_stale ? 0 : 1); }
  var CARE_SLACK = 0.15;
  function careSlack(best) { return Math.max(best * (1 + CARE_SLACK), best + 1); }

  /**
   * Rank care candidates for origin o by ROAD distance: A* to the straight-line-nearest candidates, stopping once the
   * straight line (a lower bound of the road trip) cannot beat the k-th best road any more. Unreachable ones follow,
   * by straight line. `pick` = best capability score within max(+15%, +1 km) of the nearest by road — a 24/7 or
   * trauma-capable facility slightly farther beats a closed day-time station.
   * @param {Array} cands facilities sorted by distance_km (NC.data.nearestFacilities)
   * @param {{k?:number}} [opts] number of results needed (default 1)
   * @returns {{list:Array<{f:Object, road:Object|null}>, nearest:Object|null, pick:Object|null, far:number|null}}
   */
  function rankCare(o, cands, opts) {
    var k = (opts && opts.k) || 1;
    var sn = S.graph && o ? R().snap(S.graph, o) : null;
    var far = sn && sn.distance_km > FAR_KM ? sn.distance_km : null;
    var rows = [], kms = [];
    for (var i = 0; i < cands.length; i++) {
      var f = cands[i];
      if (far || !S.graph) { rows.push({ f: f, road: null }); continue; }
      if (kms.length && rows.length >= k) {
        var kth = kms.length >= k ? kms[k - 1] : Infinity;
        if ((f.distance_km || 0) > Math.max(kth, careSlack(kms[0]))) break;
      }
      if (rows.length >= 30) break;
      var road = roadTo(o, f);
      rows.push({ f: f, road: road });
      if (road) { kms.push(road.km); kms.sort(function (a, b) { return a - b; }); }
    }
    rows.sort(function (a, b) {
      if (a.road && b.road) return (a.road.km - b.road.km) || ((b.f.trauma_capable ? 1 : 0) - (a.f.trauma_capable ? 1 : 0));
      if (a.road) return -1;
      if (b.road) return 1;
      return (a.f.distance_km || 0) - (b.f.distance_km || 0);
    });
    var nearest = rows[0] || null, pick = nearest;
    if (nearest && !far) { // hundreds of km away a capability "recommendation" would be noise
      var base = nearest.road ? nearest.road.km : (nearest.f.distance_km || 0);
      var lim = careSlack(base);
      rows.forEach(function (r) {
        if (!!r.road !== !!nearest.road) return;
        var d = r.road ? r.road.km : (r.f.distance_km || 0);
        if (d <= lim && careScore(r.f) > careScore(pick.f)) pick = r;
      });
    }
    return { list: rows, nearest: nearest, pick: pick, far: far };
  }

  function facCard(f, road, o) {
    o = o || {};
    var badges = [];
    if (o.first) badges.push(NC.ui.badge(t('mp.med.nearest'), 'solid', 'navigation'));
    if (o.pick) badges.push(NC.ui.badge(t('mp.med.recommended'), 'primary', 'star'));
    if (f.night_shift) badges.push(NC.ui.badge(t('mp.med.night'), 'success', 'moon'));
    if (f.trauma_capable) badges.push(NC.ui.badge(t('mp.med.trauma'), 'danger', 'bandage'));
    if (f.open_hours) badges.push(NC.ui.badge(f.open_hours, 'neutral', 'clock'));
    if (availableNow(f) === false) badges.push(NC.ui.badge(t('mp.med.closed_now'), 'warning', 'clock'));
    if (f.is_demo) badges.push(NC.ui.demoBadge());
    var verify = f.is_stale ?
      '<p class="mp-fac__line mp-fac__line--stale">' + ic('alert-triangle') + '<span>' + esc(t('mp.med.stale', { date: U.fmtDate(f.verified_at), n: f.days_since_verified })) + '</span></p>' :
      '<p class="mp-fac__line">' + ic('check-circle', 'text-success') + '<span>' + esc(t('mp.med.verified', { date: U.fmtDate(f.verified_at), ago: f.days_since_verified > 0 ? t('mp.med.days_ago', { n: f.days_since_verified }) : t('mp.med.today') })) + '</span></p>';
    var air = f.distance_km === null || f.distance_km === undefined ? null : f.distance_km;
    var roadLine = '';
    if (road) {
      roadLine = '<p class="mp-fac__line">' + ic('route') + '<span>' + esc(t('mp.med.road', { eta: dur(etaMin(road.km)), mode: t('mp.mode.' + S.mode).toLowerCase(), air: air === null ? '–' : km(air) })) +
        (road.off > 0.3 ? ' · ' + esc(t('mp.med.offroute', { d: km(road.off) })) : '') + (road.an.lost_km > 0.05 ? ' ' + lostLine(road.an) : '') + '</span></p>';
    } else if (!o.far && air !== null) {
      roadLine = '<p class="mp-fac__line">' + ic('info') + '<span>' + esc(t('mp.med.noroad')) + '</span></p>';
    }
    var big = road ? road.km : air;
    return '<article class="card mp-fac' + (o.first ? ' mp-fac--first' : '') + (o.pick ? ' mp-fac--pick' : '') + (f.is_stale ? ' mp-fac--stale' : '') + '">' +
      '<div class="mp-fac__top">' + sheetIconTile(f.type, 'md') +
      '<div class="mp-fac__id"><h3 class="mp-fac__name">' + esc(f.name) + '</h3><p class="mp-fac__type">' + esc(t('mp.type.' + f.type)) + '</p></div>' +
      '<div class="mp-fac__dist"><b>' + esc(big === null ? '–' : num(big, big >= 10 ? 0 : 1)) + '</b><small>' + esc(t(road ? 'mp.med.km_road' : 'mp.med.km_air')) + '</small></div></div>' +
      (f.address ? '<p class="mp-fac__addr">' + ic('map-pin') + '<span>' + esc(f.address) + '</span></p>' : '') +
      '<div class="mp-fac__badges">' + badges.join('') + '</div>' + roadLine + verify +
      '<div class="mp-fac__actions"><button class="btn btn--primary btn--sm" type="button" data-mp="fac-dir" data-id="' + esc(f.id) + '">' + ic('navigation') + '<span>' + esc(t('mp.med.directions')) + '</span></button>' +
      (f.phone ? '<button class="btn btn--outline btn--sm" type="button" data-call="' + esc(f.phone) + '">' + ic('phone') + '<span>' + esc(t('common.call')) + '</span></button>' : '') +
      '<button class="btn btn--ghost btn--sm" type="button" data-mp="fac-report" data-id="' + esc(f.id) + '">' + ic('flag') + '<span>' + esc(t('mp.med.report')) + '</span></button></div>' +
      '</article>';
  }

  /* ---------- stops ---------- */
  function renderStops() {
    var box = S.els.stops;
    if (!box || !S.graph) return;
    var items, title;
    var r = S.result;
    if (r && r.main) {
      items = r.stops.filter(function (s) { return STOP_GROUPS.indexOf(s.poi.type) >= 0; });
      title = t('mp.stops.along_title', { from: shortName(fromLabel()), to: shortName(destLabel(S.to)) });
    } else {
      var o = originPoint();
      var pois = S.graph.services.concat(S.facilities.filter(function (f) { return f.type === 'nha_thuoc'; }));
      items = o ? pois.map(function (p) { return { poi: p, dist_km: R().haversineKm(o, p) }; })
        .filter(function (s) { return s.dist_km <= NEAR_KM; })
        .sort(function (a, b) { return a.dist_km - b.dist_km; }) : [];
      title = t('mp.stops.near_title', { km: km(NEAR_KM) });
    }
    var html = '<div class="mp-stops-head"><h2 class="mp-h">' + esc(title) + '</h2>' +
      (!(r && r.main) ? '<p class="muted small">' + esc(t('mp.stops.hint')) + '</p>' : '') + '</div>';
    if (!(r && r.main)) html = posLine() + html;
    var any = false;
    STOP_GROUPS.forEach(function (ty) {
      var g = items.filter(function (s) { return s.poi.type === ty; });
      if (!g.length) return;
      any = true;
      html += '<section class="mp-group"><div class="section-head"><h3 class="section-head__title">' + sheetIconTile(ty) + '<span>' + esc(t('mp.type.' + ty)) + '</span></h3>' +
        NC.ui.badge(String(g.length), 'neutral') + '</div>' +
        '<div class="list list--card">' + g.map(function (s) { return stopItem(s); }).join('') + '</div></section>';
    });
    if (!any) html += '<p class="muted small">' + esc(t('mp.stops.empty')) + '</p>';
    html += '<p class="mp-note">' + ic('info') + '<span>' + esc(t('mp.stops.partner_note')) + '</span></p>';
    box.innerHTML = html;
  }

  /* ---------- packs ---------- */
  function storageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate().catch(function () { return null; });
    } catch (e) { /* ignore */ }
    return Promise.resolve(null);
  }

  function bytes(n) { return n >= 1073741824 ? num(n / 1073741824, 1) + ' GB' : U.fmtBytes(n); }

  /* Offline vector basemap rows (all corridors): download state, size on the server when not downloaded. */
  function basemapRows(online) {
    if (!NC.basemap) return Promise.resolve(null);
    return NC.basemap.list().then(function (sts) {
      return Promise.all(sts.map(function (st) {
        if (st.downloaded || !online) return st;
        return NC.basemap.size(st.route_id).then(function (n) { return Object.assign({}, st, { server_bytes: n }); });
      }));
    }).catch(function () { return null; });
  }
  function basemapCard(rows, online) {
    if (!rows) return '';
    var ok = NC.basemap.supported();
    var html = '<article class="card mp-bm" id="mp-bm"><header class="card__header"><div><h2 class="card__title">' + esc(t('mp.bm.title')) + '</h2>' +
      '<p class="card__subtitle">' + esc(t('mp.bm.sub')) + '</p></div></header><div class="list">';
    rows.forEach(function (st) {
      var rid = st.route_id, name = shortName(routeName(rid));
      var na = st.server_bytes === false && !st.downloaded;
      var state = !ok ? t('mp.bm.st.unsupported') :
        st.downloaded ? (st.generated_at ? t('mp.bm.st.done', { size: st.bytes ? U.fmtBytes(st.bytes) : '–', date: U.fmtDate(st.generated_at) }) : t('mp.bm.st.done_nodate', { size: st.bytes ? U.fmtBytes(st.bytes) : '–' })) :
        na ? t('mp.bm.st.na') : st.server_bytes ? t('mp.bm.st.none_size', { size: U.fmtBytes(st.server_bytes) }) : t('mp.bm.st.none');
      var r = routeMeta(rid);
      html += '<div class="list-item mp-bmrow' + (rid === S.routeId ? ' is-current' : '') + '">' +
        '<span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + (st.downloaded ? 'success' : 'neutral') + '">' + ic(st.downloaded ? 'check-circle' : 'map') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + esc(r && lang() === 'en' && r.name_en ? shortName(r.name_en) : name) + '</span>' +
        '<span class="list-item__meta"><span>' + esc(state) + '</span></span></span><span class="list-item__trail">' +
        (st.downloaded ? '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-mp="bm-remove" data-route="' + esc(rid) + '" aria-label="' + esc(t('mp.bm.remove', { route: name })) + '" title="' + esc(t('mp.bm.remove', { route: name })) + '">' + ic('trash') + '</button>' : '') +
        (!st.downloaded && ok && !na ? '<button class="btn btn--soft btn--icon btn--sm" type="button" data-mp="bm-download" data-route="' + esc(rid) + '"' + (online ? '' : ' disabled') + ' aria-label="' + esc(t('mp.bm.download', { route: name })) + '" title="' + esc(t('mp.bm.download', { route: name })) + '">' + ic('download') + '</button>' : '') +
        '</span></div>';
    });
    html += '</div>' + (!online ? '<p class="mp-small">' + ic('wifi-off') + '<span>' + esc(t('bm.offline')) + '</span></p>' : '') +
      '<p class="mp-small">' + ic('info') + '<span>' + esc(t('mp.bm.attr')) + '</span></p></article>';
    return html;
  }

  function renderPacks() {
    var box = S.els.packs;
    if (!box || !NC.data) return;
    var gen = ++S.pkGen;
    var rid = S.routeId, car = S.carrier;
    var online = NC.net ? NC.net.online() : navigator.onLine !== false;
    if (!box.firstChild) box.innerHTML = '<div class="skeleton skeleton--card"></div>';
    var techWasOpen = !!box.querySelector('details.mp-tech[open]');
    Promise.all([
      NC.data.listRoutes().catch(function () { return []; }),
      NC.data.listDownloadedPacks().catch(function () { return []; }),
      Promise.resolve(S.packs[rid] || NC.data.getPack(rid, car)).catch(function () { return null; }),
      storageEstimate(),
      basemapRows(online)
    ]).then(function (res) {
      if (gen !== S.pkGen) return;
      var routes = res[0] || [], stored = res[1] || [], pack = res[2], est = res[3], bmRows = res[4];
      var row = routes.filter(function (x) { return x.id === rid; })[0] || {};
      var dl = row.downloaded && row.downloaded[car];
      var srv = row.packs && row.packs[car];
      var src = pack ? (pack.source || 'bundled') : 'bundled';
      var acc = pack && typeof pack.accuracy === 'number' ? pack.accuracy : (row.accuracy ? row.accuracy[car] : null);
      var label, disabled = !online;
      if (dl && dl.update_available && srv) label = t('mp.pk.update');
      else if (dl) label = t('mp.pk.redownload');
      else label = t('mp.pk.download');
      // 1. the route's data pack: one status line + one action (technical detail lives in the disclosure below)
      var html = '<article class="card mp-pk">' +
        '<div class="mp-pk__head"><span class="icon-tile icon-tile--primary">' + ic('package') + '</span>' +
        '<div class="mp-pk__id"><h2 class="card__title">' + esc(shortName(routeName(rid))) + '</h2>' +
        '<span class="mp-pk__src">' + ic(src === 'downloaded' ? 'check-circle' : src === 'server' ? 'cloud' : 'hard-drive') + esc(carrierName(car) + ' · ' + t('mp.pk.src.' + src)) + '</span></div></div>' +
        // a server copy that is not saved yet says what downloading gives, never "works offline" (R1.8)
        '<p class="mp-pk__lead">' + esc(t(src === 'server' ? 'mp.pk.lead_server' : 'mp.pk.lead')) + '</p>' +
        '<button class="btn btn--outline btn--block mp-pk__dl" type="button" data-mp="pk-download" data-route="' + esc(rid) + '"' + (disabled ? ' disabled' : '') + '>' + ic('download') + '<span>' + esc(label) + '</span></button>' +
        (!online ? '<p class="mp-pk__offline">' + ic('wifi-off') + '<span>' + esc(t('mp.pk.offline')) + '</span></p>' : '') +
        '</article>';
      // 2. offline vector basemap per corridor
      html += basemapCard(bmRows, online);
      // 3. routes list (current carrier)
      html += '<article class="card"><header class="card__header"><h2 class="card__title">' + esc(t('mp.pk.routes', { carrier: carrierName(car) })) + '</h2></header><div class="list">';
      (routes.length ? routes : seedRoutes()).forEach(function (rt) {
        var d = rt.downloaded && rt.downloaded[car];
        var sp = rt.packs && rt.packs[car];
        // Label by the source actually in use for this route (downloaded / live server copy / bundled seed pack).
        var inUse = S.packsCarrier === car ? S.packs[rt.id] : null;
        var rsrc = d ? 'downloaded' : inUse ? (inUse.source || 'bundled') : (online && rt.source === 'server' ? 'server' : 'bundled');
        // one wording for the pack status everywhere on this screen (no version numbers: they live in "Chi tiết kỹ thuật")
        var state = t('mp.pk.src.' + rsrc);
        var upd = d && d.update_available && sp ? NC.ui.badge(t('mp.pk.st.update'), 'accent', 'refresh') : '';
        html += '<div class="list-item mp-pkrow' + (rt.id === rid ? ' is-current' : '') + '">' +
          '<span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + (d ? 'success' : 'neutral') + '">' + ic(MODE_ICON[rt.travel_mode] || 'route') + '</span>' +
          '<span class="list-item__body"><span class="list-item__title">' + esc(shortName(lang() === 'en' && rt.name_en ? rt.name_en : rt.name)) + '</span>' +
          '<span class="list-item__meta"><span>' + esc(state) + '</span>' + upd + '</span></span>' +
          '<span class="list-item__trail">' +
          (d ? '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-mp="pk-remove" data-route="' + esc(rt.id) + '" data-carrier="' + esc(car) + '" aria-label="' + esc(t('mp.pk.remove')) + '" title="' + esc(t('mp.pk.remove')) + '">' + ic('trash') + '</button>' : '') +
          '<button class="btn btn--soft btn--icon btn--sm" type="button" data-mp="pk-download" data-route="' + esc(rt.id) + '"' + (online ? '' : ' disabled') + ' aria-label="' + esc(t('mp.pk.download')) + '" title="' + esc(t('mp.pk.download')) + '">' + ic('download') + '</button>' +
          '</span></div>';
      });
      html += '</div></article>';
      // 4. technical detail, folded: versions, accuracy by carrier, stored packs, storage
      var accs = row.accuracy || {};
      var holdout = pack && pack.holdout_n;
      html += '<details class="disclosure disclosure--card mp-tech"' + (techWasOpen ? ' open' : '') + '><summary class="disclosure__sum">' + ic('sliders') +
        '<span class="disclosure__txt"><span class="disclosure__title">' + esc(t('mp.pk.tech')) + '</span><span class="disclosure__sub">' + esc(t('mp.pk.tech_sub')) + '</span></span>' +
        '<span class="disclosure__chev">' + ic('chevron-down') + '</span></summary>' +
        '<div class="disclosure__body mp-tech__body">' +
        '<p class="mp-sub">' + esc(t('mp.pk.eyebrow')) + ' · ' + esc(shortName(routeName(rid))) + '</p>' +
        '<dl class="mp-pk__kv">' +
        '<div><dt>' + esc(t('mp.pk.version')) + '</dt><dd>v' + esc(pack ? pack.version : '–') + '</dd></div>' +
        '<div><dt>' + esc(t('mp.pk.published')) + '</dt><dd>' + esc(pack && pack.published_at ? U.fmtDate(pack.published_at) : '–') + '</dd></div>' +
        '<div><dt>' + esc(t('mp.pk.size')) + '</dt><dd>' + esc(pack && pack.size_bytes ? U.fmtBytes(pack.size_bytes) : '–') + '</dd></div>' +
        '<div><dt>' + esc(t('mp.pk.accuracy')) + '</dt><dd>' + esc(acc !== null && acc !== undefined ? num(acc * 100, 1) + '%' : '–') + '</dd></div>' +
        '</dl>' +
        '<h3 class="mp-h mp-tech__h">' + esc(t('mp.pk.by_carrier')) + '</h3>' +
        (holdout ? '<p class="mp-small mp-tech__lead">' + esc(t('mp.pk.by_carrier_sub', { n: holdout })) + '</p>' : '') +
        '<div class="mp-acc__grid"><div class="mp-acc__ring" data-slot="ring"></div><div class="mp-acc__bars" data-slot="bars"></div></div>' +
        (pack && pack.model_version ? '<p class="mp-small">' + ic('info') + '<span>' + esc(t('mp.pk.model', { m: pack.model_version })) + '</span></p>' : '') +
        '<div class="divider"></div><p class="mp-sub">' + esc(t('mp.pk.stored')) + '</p>';
      if (!stored.length) html += '<p class="muted small">' + esc(t('mp.pk.none_stored')) + '</p>';
      else {
        html += '<ul class="mp-stored">' + stored.map(function (p) {
          return '<li><span>' + ic('hard-drive') + esc(shortName(routeName(p.route_id)) + ' · ' + carrierName(p.carrier)) + '</span><span class="muted">v' + esc(p.version) + ' · ' + esc(U.fmtBytes(p.size_bytes)) + ' · ' + esc(U.fmtDate(p.downloaded_at)) + '</span>' +
            '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-mp="pk-remove" data-route="' + esc(p.route_id) + '" data-carrier="' + esc(p.carrier) + '" aria-label="' + esc(t('mp.pk.remove')) + '">' + ic('trash') + '</button></li>';
        }).join('') + '</ul>';
      }
      if (est && est.quota) html += '<p class="mp-small">' + ic('database') + '<span>' + esc(t('mp.pk.storage', { used: bytes(est.usage || 0), quota: bytes(est.quota) })) + '</span></p>';
      html += '</div></details>';
      // 5. community logs
      var logsOn = !!(NC.settings && NC.settings.get('community_logs'));
      html += '<article class="card mp-logs"><label class="switch switch--end"><input type="checkbox" id="mp-logs"' + (logsOn ? ' checked' : '') + '>' +
        '<span class="switch__track"></span><span class="switch__label"><b>' + esc(t('mp.pk.logs')) + '</b><small>' + esc(t('mp.pk.logs_text')) + '</small></span></label></article>';
      box.innerHTML = html;
      var ringSlot = box.querySelector('[data-slot="ring"]');
      if (ringSlot && NC.viz && acc !== null && acc !== undefined) ringSlot.appendChild(NC.viz.ring(acc, { size: 92, stroke: 9, label: Math.round(acc * 100) + '%', sublabel: carrierName(car), tone: 'primary' }));
      var barSlot = box.querySelector('[data-slot="bars"]');
      if (barSlot && NC.viz) {
        var data = (NC.app.carriers ? NC.app.carriers() : [{ id: 'viettel', name: 'Viettel' }]).map(function (c) {
          var v = accs[c.id];
          return { label: c.name, value: typeof v === 'number' ? Math.round(v * 1000) / 10 : 0, color: c.id === car ? 'primary' : 'muted' };
        });
        barSlot.appendChild(NC.viz.bars(data, { unit: '%', max: 100, rowHeight: 34 }));
      }
      var sw = box.querySelector('#mp-logs');
      if (sw) sw.addEventListener('change', function () {
        if (NC.settings) NC.settings.set('community_logs', sw.checked);
        toast(t(sw.checked ? 'mp.pk.logs_on' : 'mp.pk.logs_off'), { type: sw.checked ? 'success' : 'info', timeout: 2400 });
      });
      if (S.focusBm) {
        S.focusBm = false;
        var card = box.querySelector('#mp-bm');
        if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'start' }); } catch (e) { card.scrollIntoView(); } }
      }
    });
  }

  /* ---------- far-from-route banner ---------- */
  function checkFar() {
    if (!S.graph || !S.pos) { S.far = null; renderFar(); return; }
    var sn = R().snap(S.graph, S.pos);
    S.far = sn && sn.distance_km > FAR_KM ? sn.distance_km : null;
    renderFar();
  }
  function renderFar() {
    var el = S.els.far;
    if (!el) return;
    var show = !!S.far && !S.farDismissed;
    el.hidden = !show;
    if (!show) return;
    var demo = isDemo(); // outside the demo the simulated position stays in "Chế độ demo" (R1)
    el.innerHTML = '<span class="icon-tile icon-tile--sm icon-tile--warning">' + ic(demo ? 'crosshair' : 'info') + '</span>' +
      '<div class="mp-far__body"><p>' + esc(t(demo ? 'mp.pos.far' : 'mp.pos.far_real', { d: km(S.far) })) + '</p><div class="cluster">' +
      (demo ? '<button class="btn btn--sm btn--primary" type="button" data-mp="sim">' + esc(t('mp.pos.far_btn')) + '</button>' : '') +
      '<button class="btn btn--sm btn--ghost" type="button" data-mp="far-dismiss">' + esc(t('mp.far.later')) + '</button></div></div>';
  }

  /* ================================================================== comboboxes (From + To) */
  /*
   * Both fields list offline results (verified facilities, services, pilot-route places) and, when online, one
   * "Trực tuyến · OpenStreetMap" group: the one-line consent (first time), then "Tìm “q” trên toàn Việt Nam"
   * (only on Enter or a tap on that row — the Nominatim usage policy forbids client-side autocomplete), results, errors.
   * The From field adds "Vị trí của tôi" and "Chọn trên bản đồ". Only options are focusable rows (role=option).
   */
  function comboQuery(which) {
    var c = S.cb[which];
    if (!c) return '';
    var q = c.input.value;
    return q === fieldLabel(which) ? '' : q.trim();
  }
  function geoOnlineOk() { var G = NC.geoOnline; return !!(G && G.search && G.available()); }
  function errWhy(code) { return t('mp.err.' + (code || 'http')); }
  function meItem() {
    var p = S.pos, perm = S.geoPerm;
    var meta = p ? (p.source === 'gps' ? t('mp.combo.me_gps', { m: p.accuracy_m || '–', ago: U.relTime ? U.relTime(p.at) : '' }) : t('mp.plan.me_sim')) :
      perm === 'denied' ? t('mp.combo.me_denied') : perm === 'unsupported' ? t('mp.combo.me_na') : t('mp.combo.me_none');
    return { kind: 'me', label: t('mp.plan.me'), meta: meta, icon: 'locate', tone: p ? 'primary' : 'neutral', disabled: !p && (perm === 'denied' || perm === 'unsupported') };
  }
  function comboOptions(q, which) {
    var groups = [];
    var nq = U.normalize(q || '');
    var o = originPoint();
    var facs = S.facilities.filter(function (f) { return CARE_TYPES.indexOf(f.type) >= 0 || f.type === 'nha_thuoc'; });
    var svcs = S.graph ? S.graph.services.slice() : [];
    var nodes = [];
    routeIdsOrdered().forEach(function (rid) { nodes = nodes.concat(routeNodes(rid)); });
    function match(s) { return U.normalize(s || '').indexOf(nq) >= 0; }
    if (which === 'from') {
      groups.push({ title: t('mp.combo.here'), items: [meItem(), { kind: 'pick', label: t('mp.combo.pick'), meta: t('mp.combo.pick_meta'), icon: 'crosshair', tone: 'neutral' }] });
    }
    if (nq) {
      facs = facs.filter(function (f) { return match(f.name) || match(f.address) || match(t('mp.type.' + f.type)); });
      svcs = svcs.filter(function (s) { return match(s.name) || match(s.address) || match(t('mp.type.' + s.type)); });
      nodes = nodes.filter(function (n) { return match(n.name) || match(n.name_en); });
    } else {
      nodes = routeNodes(S.routeId);
      svcs = [];
      if (which === 'from') facs = [];
    }
    var dist = function (p) { return o ? R().haversineKm(o, p) : 0; };
    if (o) { facs = facs.slice().sort(function (a, b) { return dist(a) - dist(b); }); svcs.sort(function (a, b) { return dist(a) - dist(b); }); }
    facs = facs.slice(0, nq ? 8 : 4);
    svcs = svcs.slice(0, 6);
    nodes = nodes.slice(0, nq ? 10 : 30);
    var offline = 0;
    if (facs.length) groups.push({ title: t('mp.combo.facs'), items: facs.map(function (f) {
      return { kind: 'fac', id: f.id, label: f.name, meta: t('mp.type.' + f.type) + (o ? ' · ' + km(dist(f)) : ''), icon: NC.mapkit.iconFor(f.type), tone: TONE[f.type] };
    }) });
    if (svcs.length) groups.push({ title: t('mp.combo.svcs'), items: svcs.map(function (s) {
      return { kind: 'svc', id: s.id, label: s.name, meta: t('mp.type.' + s.type) + (o ? ' · ' + km(dist(s)) : ''), icon: NC.mapkit.iconFor(s.type), tone: TONE[s.type] };
    }) });
    if (nodes.length) groups.push({ title: t('mp.combo.nodes'), items: nodes.map(function (n) {
      return { kind: 'node', id: n.id, label: nodeName(n), meta: t('mp.kind.' + n.kind) + ' · ' + shortName(routeName(n.route_id)), icon: KIND_ICON[n.kind] || 'map-pin', tone: 'neutral' };
    }) });
    if (nq) offline = facs.length + svcs.length + nodes.length;
    // online group
    if (q && q.length >= 2) {
      var items = [];
      var G = NC.geoOnline;
      if (!geoOnlineOk()) {
        if (!offline) items.push({ info: true, icon: 'wifi-off', label: t('mp.combo.offline_hint') });
      } else if (!G.consented()) {
        items.push({ kind: 'consent', label: t('mp.combo.consent_ok'), meta: t('mp.combo.consent'), icon: 'globe', tone: 'primary', cls: 'mp-opt--consent' });
      } else {
        var os = S.os && S.os.q === NC.geoOnline.pure.normQuery(q) ? S.os : null;
        if (!os) items.push({ kind: 'go', label: t('mp.combo.go', { q: q }), meta: t('mp.combo.go_meta'), icon: 'search', tone: 'primary', cls: 'mp-opt--go' });
        else if (os.status === 'loading') items.push({ info: true, icon: 'globe', label: t('mp.combo.loading'), busy: true });
        else if (os.status === 'error') items.push({ kind: 'go', label: t('mp.combo.online_err', { why: errWhy(os.err) }), meta: t('mp.combo.go', { q: q }), icon: 'refresh', tone: 'warning' });
        else if (!os.items.length) items.push({ info: true, icon: 'search', label: t('mp.combo.online_none', { q: q }) });
        else os.items.forEach(function (p) {
          items.push({ kind: 'place', id: p.id, label: p.name, meta: (o ? km(R().haversineKm(o, p)) + ' · ' : '') + (p.area || p.label || ''), icon: 'map-pin', tone: 'info', place: p });
        });
        if (os && os.status === 'done' && os.items.length) items.push({ info: true, attr: true, label: t('mp.combo.attr') });
      }
      if (items.length) groups.push({ title: t('mp.combo.online'), items: items, online: true });
    }
    return { groups: groups, offline: offline };
  }
  function openCombo(which) {
    var c = S.cb[which];
    if (!c) return;
    ['from', 'to'].forEach(function (w) { if (w !== which) closeCombo(w); });
    var q = comboQuery(which);
    var res = comboOptions(q, which);
    c.items = [];
    c.offline = res.offline;
    var html = '';
    res.groups.forEach(function (g, gi) {
      html += '<li class="mp-combo__group' + (g.online ? ' mp-combo__group--online' : '') + '" role="presentation" id="mp-' + which + '-g' + gi + '">' + esc(g.title) + '</li>';
      g.items.forEach(function (it) {
        if (it.info) {
          html += '<li class="mp-combo__info' + (it.attr ? ' mp-combo__info--attr' : '') + '" role="presentation"' + (it.busy ? ' aria-busy="true"' : '') + '>' +
            (it.icon ? ic(it.icon) : '') + '<span>' + esc(it.label) + '</span></li>';
          return;
        }
        var idx = c.items.length;
        c.items.push(it);
        html += '<li class="mp-opt' + (it.cls ? ' ' + it.cls : '') + (it.disabled ? ' is-disabled' : '') + '" role="option" id="mp-' + which + '-opt-' + idx + '" data-idx="' + idx + '" aria-selected="false"' +
          (it.disabled ? ' aria-disabled="true"' : '') + '>' +
          '<span class="icon-tile icon-tile--sm icon-tile--' + (it.tone || 'neutral') + '">' + ic(it.icon) + '</span>' +
          '<span class="mp-opt__body"><span class="mp-opt__label">' + esc(it.label) + '</span><span class="mp-opt__meta">' + esc(it.meta || '') + '</span></span></li>';
      });
    });
    if (!html) html = '<li class="mp-combo__empty" role="presentation">' + esc(t('mp.combo.none', { q: q })) + '</li>';
    // no offline match for the typed text: say so (once) instead of silence; online, the list offers the online
    // search row and runOnline() announces its outcome
    if (q && !res.offline) {
      if (!geoOnlineOk()) comboAnnounce(q.length >= 2 ? t('mp.combo.offline_hint') : t('mp.combo.none', { q: q }));
      else if (q.length < 2) comboAnnounce(t('mp.combo.none', { q: q }));
    }
    c.list.innerHTML = html;
    c.list.hidden = false;
    // a listbox without any option is not valid ARIA: the rows stay visible, the message reaches screen readers
    // through #mp-combo-live instead
    if (c.items.length) c.list.removeAttribute('aria-hidden'); else c.list.setAttribute('aria-hidden', 'true');
    c.input.setAttribute('aria-expanded', c.items.length ? 'true' : 'false');
    c.input.removeAttribute('aria-activedescendant');
    c.active = -1;
  }
  function closeCombo(which) {
    if (!which) { closeCombo('from'); closeCombo('to'); return; }
    var c = S.cb[which];
    if (!c || !c.list) return;
    S.liveMsg = '';
    c.list.hidden = true;
    c.input.setAttribute('aria-expanded', 'false');
    c.input.removeAttribute('aria-activedescendant');
    c.active = -1;
  }
  function setComboActive(which, i) {
    var c = S.cb[which];
    var opts = U.$$('.mp-opt', c.list);
    if (!opts.length) return;
    c.active = (i + opts.length) % opts.length;
    opts.forEach(function (o, k) {
      var on = k === c.active;
      o.classList.toggle('is-active', on);
      o.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { c.input.setAttribute('aria-activedescendant', o.id); if (o.scrollIntoView) o.scrollIntoView({ block: 'nearest' }); }
    });
  }
  /* Polite announcement in #mp-combo-live (a repeated message is only re-announced when forced). */
  function comboAnnounce(msg, force) {
    var el = S.els.comboLive;
    if (!el || (!force && msg === S.liveMsg)) return;
    S.liveMsg = msg;
    clearTimeout(S.liveT);
    el.textContent = '';
    if (msg) S.liveT = setTimeout(function () { el.textContent = msg; }, 80);
  }
  /* One online search at a time (NC.geoOnline queues ≤ 1 request/s and aborts the previous one). */
  function runOnline(which, q) {
    var G = NC.geoOnline;
    if (!G || !q || q.length < 2) return; // submit-only (Enter / the "Tìm …" row): never a typing-pause timer
    var nq = G.pure.normQuery(q);
    if (S.os && S.os.q === nq && S.os.which === which && S.os.status === 'loading') return; // the same search is already on its way
    S.os = { which: which, q: nq, status: 'loading', items: [], err: null };
    var c = S.cb[which];
    var refresh = function () { if (c && !c.list.hidden && document.activeElement === c.input) openCombo(which); };
    refresh();
    comboAnnounce(t('mp.combo.loading'), true);
    G.search(q, { near: originPoint() }).then(function (list) {
      if (!S.os || S.os.q !== nq) return;
      S.os.status = 'done';
      S.os.items = list || [];
      refresh();
      comboAnnounce(S.os.items.length ? t('mp.combo.live_n', { n: S.os.items.length }) : t('mp.combo.online_none', { q: q }), true);
    }, function (e) {
      if (!S.os || S.os.q !== nq || (e && e.code === 'aborted')) return;
      S.os.status = 'error';
      S.os.err = (e && e.code) || 'http';
      refresh();
      comboAnnounce(t('mp.combo.online_err', { why: errWhy(S.os.err) }), true);
    });
  }
  function pickCombo(which, i) {
    var c = S.cb[which];
    var it = c && c.items[i];
    if (!it || it.disabled) return;
    var q = comboQuery(which);
    if (it.kind === 'consent') {
      Promise.resolve(NC.geoOnline.accept()).then(function () { runOnline(which, q); });
      c.input.focus();
      return;
    }
    if (it.kind === 'go') { runOnline(which, q); c.input.focus(); return; }
    closeCombo(which);
    c.input.blur();
    if (it.kind === 'pick') { startPick(which); return; }
    if (it.kind === 'me') {
      if (S.pos) setFrom('me');
      else enableGeo(null, function () { setFrom('me'); }); // the browser prompt from this tap / Enter
      return;
    }
    var d = it.kind === 'place' ? { kind: 'place', id: it.id, lat: it.place.lat, lng: it.place.lng, label: it.place.name } : destFor(it.id);
    if (!d) return;
    if (which === 'to') setDest(d);
    else setFrom(asFrom(d));
  }
  function onComboKey(which, e) {
    var c = S.cb[which];
    if (e.key === 'ArrowDown') { e.preventDefault(); if (c.list.hidden) openCombo(which); setComboActive(which, c.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboActive(which, c.active - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (c.list.hidden) openCombo(which);
      if (c.active >= 0) { pickCombo(which, c.active); return; }
      var q = comboQuery(which);
      // Enter = submit: online search across Vietnam when possible, else the first offline match
      if (q.length >= 2 && geoOnlineOk()) {
        if (NC.geoOnline.consented()) runOnline(which, q);
        else { var k = c.items.map(function (x) { return x.kind; }).indexOf('consent'); if (k >= 0) setComboActive(which, k); }
        return;
      }
      var first = c.items.map(function (x) { return !x.disabled && x.kind !== 'pick' && x.kind !== 'me'; }).indexOf(true);
      if (first >= 0) pickCombo(which, first);
    } else if (e.key === 'Escape') { closeCombo(which); c.input.value = fieldLabel(which); }
  }
  function wireCombo(which) {
    var c = S.cb[which];
    if (!c || !c.input || !c.list) return;
    var input = c.input;
    input.addEventListener('focus', function () {
      // phones: give the suggestion list room (full panel, planner at the top of the scroll area)
      if (isSheet() && S.snap !== 'full') applySnap('full');
      var plan = S.root.querySelector('#mp-plan');
      if (plan && S.els.body && S.tab === 'route') S.els.body.scrollTop = Math.max(0, plan.offsetTop - 12);
      if (which === 'from' && S.from === 'me' && input.value === fieldLabel('from')) input.select();
      openCombo(which);
    });
    input.addEventListener('input', U.debounce(function () {
      if (c.clear) c.clear.hidden = !input.value && (which === 'to' ? !S.to : S.from === 'me');
      openCombo(which);
    }, 90));
    input.addEventListener('keydown', function (e) { onComboKey(which, e); });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (S.root.contains(document.activeElement) && c.list.contains(document.activeElement)) return;
        if (document.activeElement === input) return;
        closeCombo(which);
        input.value = fieldLabel(which);
        if (c.clear) c.clear.hidden = which === 'to' ? !S.to : S.from === 'me';
      }, 160);
    });
    c.list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    c.list.addEventListener('click', function (e) {
      var o = e.target.closest ? e.target.closest('.mp-opt') : null;
      if (o) pickCombo(which, +o.getAttribute('data-idx'));
    });
  }

  /* ---------- "Chọn trên bản đồ" (From field): the next map tap sets the start point ---------- */
  function startPick(which) {
    stopPick();
    S.picking = which || 'from';
    S.root.classList.add('mp-picking');
    var el = S.els.pick;
    if (el) {
      el.innerHTML = ic('crosshair') + '<span>' + esc(t('mp.pick.hint')) + '</span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-mp="pick-cancel">' + esc(t('mp.pick.cancel')) + '</button>';
      el.hidden = false;
    }
    if (isSheet() && S.snap !== 'peek') applySnap('peek');
    S.pickRel = NC.ui.onBack ? NC.ui.onBack(function () { S.pickRel = null; stopPick(); }) : null;
    document.addEventListener('keydown', onPickKey, true);
    scheduleDeclutter();
  }
  function stopPick() {
    if (!S.picking && !S.pickRel) return;
    S.picking = null;
    if (S.root) S.root.classList.remove('mp-picking');
    if (S.els.pick) { S.els.pick.hidden = true; S.els.pick.innerHTML = ''; }
    document.removeEventListener('keydown', onPickKey, true);
    if (S.pickRel) { var rel = S.pickRel; S.pickRel = null; rel(); }
  }
  function onPickKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    e.preventDefault();
    e.stopPropagation();
    stopPick();
  }
  function onMapPick(e) {
    if (!S.picking || !e || !e.latlng) return;
    var which = S.picking;
    stopPick();
    var p = { kind: 'point', lat: e.latlng.lat, lng: e.latlng.lng };
    if (which === 'to') setDest(p);
    else setFrom(p);
    toast(t('mp.pick.done'), { type: 'success', timeout: 1800 });
    if (isSheet() && S.snap === 'peek') applySnap('half');
  }

  /* ================================================================== actions */
  function setDest(d, opts) {
    S.to = d;
    if (d && S.from === 'me' && !S.pos && d.kind !== 'place') {
      // no position yet → start from the first node of the destination's route (an online place asks for a start)
      var rid = d.kind === 'node' ? (node(d.id) || {}).route_id : ((facById(d.id) || svcById(d.id) || {}).route_id || S.routeId);
      var ns = routeNodes(rid);
      if (ns.length) S.from = ns[0].id === d.id && ns[1] ? ns[1].id : ns[0].id;
    }
    S.partsOpen = false;
    computeRoute(opts);
    drawPois();
    if (!(opts && opts.keepTab)) setTab('route', { silent: true });
    if (isSheet() && S.snap === 'peek') applySnap('half');
  }
  function setFrom(v) {
    S.from = v;
    S.partsOpen = false;
    computeRoute();
  }
  function setStrategy(v) {
    if (v !== 'shortest' && v !== 'signal') return;
    S.strategy = v;
    persistUi();
    computeRoute({ fit: false });
  }
  /* Travel mode from the segmented control or from Settings / onboarding / MOD.04 (settings:change): the result,
     its TripPlan (mode, speed, route_key) and kv 'map.last_route' always follow, so "Bắt đầu đi" never starts a trip
     in the previous mode. */
  function setMode(v, opts) {
    if (!MODE_ICON[v]) return;
    S.mode = v;
    if (opts && opts.fromSetting) { if (S.segMode) S.segMode.set(v); }
    else if (NC.settings && NC.settings.get('travel_mode') !== v) NC.settings.set('travel_mode', v);
    var r = S.result;
    // online routes depend on the mode (OSRM car vs foot profile); offline A* only changes its ETA
    if (r && (r.source === 'online' || r.gate)) computeRoute({ fit: false });
    else {
      if (r && r.main && !r.far) {
        r.plan = buildPlan(r);
        saveLast();
      }
      renderSummary();
      renderResult();
    }
    if (S.tab === 'med') renderMed();
  }
  function setPos(p, opts) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return;
    S.pos = { lat: +p.lat, lng: +p.lng, at: p.at || nowIso(), source: p.source || 'sim' };
    if (p.accuracy_m) S.pos.accuracy_m = p.accuracy_m;
    S._ownPos = S.pos;
    if (NC.settings && !(opts && opts.nosave)) NC.settings.set('last_position', S.pos);
    S.farDismissed = false;
    drawUser();
    checkFar();
    renderChips();
    if ((S.from === 'me' && S.to) || endIsMe('to')) computeRoute({ fit: !(opts && opts.nofit) });
    else renderPlanner();
    if (S.tab === 'med') renderMed();
    if (S.tab === 'stops') renderStops();
    if (opts && opts.fly && S.map) S.map.setView([S.pos.lat, S.pos.lng], Math.max(S.map.getZoom(), 12), { animate: false });
  }

  function locate(btn) {
    if (!navigator.geolocation) { toast(t('mp.gps.unsupported'), { type: 'warning' }); openSimSheet(); return; }
    if (btn) btn.classList.add('is-loading');
    if (btn) btn.setAttribute('aria-busy', 'true');
    function done() { if (btn) { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); } }
    function apply(g, cachedOk) {
      done();
      var c = g.coords;
      // same sanity rule as NC.geo (a timestamp outside [now − 24 h, now + 5 min] → now), so the age below is real
      var at = new Date(NC.geo && NC.geo.fixTime ? NC.geo.fixTime(g.timestamp) : (g.timestamp || Date.now()));
      var m = Math.round(c.accuracy || 0);
      var pos = { lat: c.latitude, lng: c.longitude, source: 'gps', accuracy_m: m, at: at.toISOString() };
      if (NC.geo && NC.geo.note) NC.geo.note(pos, { real: true }); // an explicit GPS tap = the real position, also in the demo
      setPos(pos, { fly: true });
      refreshGeoPerm();
      // Some engines still hand back an older fix; say so instead of claiming a fresh update.
      var age = Date.now() - at.getTime();
      if (cachedOk || age > 15000) toast(t('mp.gps.cached', { ago: U.relTime ? U.relTime(at.toISOString()) : dur(age / 60000), m: m }), { type: 'info', timeout: 4200 });
      else toast(t('mp.gps.ok', { m: m }), { type: 'success', timeout: 2200 });
    }
    function fail(err) {
      done();
      var denied = err && err.code === 1;
      refreshGeoPerm();
      toast(t(denied ? 'mp.gps.denied' : 'mp.gps.error'), { type: 'warning', timeout: denied ? 6000 : 4500, action: { label: t('mp.fab.sim'), onClick: openSimSheet } });
    }
    // An explicit tap asks for a fresh fix (maximumAge 0). Only when that times out do we accept a recent cached
    // fix (≤ 10 min), clearly labelled as such.
    navigator.geolocation.getCurrentPosition(function (g) { apply(g, false); }, function (err) {
      if (err && err.code === 3) {
        navigator.geolocation.getCurrentPosition(function (g) { apply(g, true); }, fail, { enableHighAccuracy: false, timeout: 4000, maximumAge: 600000 });
        return;
      }
      fail(err);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  function toNearestCare() {
    var o = originPoint();
    if (!o) { openSimSheet(); return; }
    // Straight-line candidates → ranked by the road trip on the pack graph (see rankCare), same order as the list.
    NC.data.nearestFacilities(o, { limit: 60, types: CARE_TYPES }).then(function (list) {
      var rk = rankCare(o, list || [], { k: 1 });
      var pick = rk.pick;
      if (!pick) return;
      var f = pick.f;
      if (S.from !== 'me' && S.pos) S.from = 'me';
      setDest({ kind: 'fac', id: f.id, lat: f.lat, lng: f.lng });
      var near = rk.nearest;
      if (near && pick !== near && pick.road && near.road) {
        var why = [];
        if (availableNow(f) === true && availableNow(near.f) !== true) why.push(t(is247(f) ? 'mp.care.why_24' : 'mp.care.why_open'));
        if (f.trauma_capable && !near.f.trauma_capable) why.push(t('mp.care.why_trauma'));
        if (!f.is_stale && near.f.is_stale) why.push(t('mp.care.why_fresh'));
        if (!why.length) why.push(t(is247(f) ? 'mp.care.why_24' : 'mp.care.why_open'));
        toast(t('mp.care.picked', { name: f.name, why: why.join(', '), d: km(pick.road.km - near.road.km), near: near.f.name }), { type: 'info', timeout: 6500 });
      }
    });
  }

  /* ---------- trip (NC.trip, contract C2/C4): "Bắt đầu đi" / "Đang đi · Kết thúc" / "Gửi vị trí" ---------- */
  function startTrip(btn) {
    var r = S.result;
    if (!r || !r.main || r.far) return;
    if (!NC.trip || typeof NC.trip.start !== 'function') { toast(t('mp.trip.na'), { type: 'warning' }); return; }
    var plan = r.plan || (r.plan = buildPlan(r));
    if (btn) S.focusIntent = 'trip-start';
    var p;
    try { p = NC.trip.start(plan, { from: 'map' }); } catch (e) { p = Promise.reject(e); } // inside the tap: it may ask for notifications
    if (btn) NC.ui.setLoading(btn, true);
    Promise.resolve(p).catch(function (e) { console.warn('[map] trip start', e && (e.code || e.message)); })
      .then(function () { if (btn && btn.isConnected !== false) NC.ui.setLoading(btn, false); renderResult(); });
  }
  function stopTrip(btn) {
    if (!NC.trip || typeof NC.trip.stop !== 'function') return;
    if (btn) { S.focusIntent = 'trip-stop'; NC.ui.setLoading(btn, true); }
    Promise.resolve(NC.trip.stop('user')).catch(function () { }).then(function () { if (btn && btn.isConnected !== false) NC.ui.setLoading(btn, false); renderResult(); });
  }
  function shareLocation() {
    if (!NC.trip || typeof NC.trip.promptShare !== 'function') { toast(t('mp.trip.na'), { type: 'warning' }); return; }
    NC.trip.promptShare({ reason: 'manual' });
  }

  function zoomZone(i) {
    var r = S.result;
    if (!r || !r.main || !S.map) return;
    var z = r.main.an.zones[i || 0];
    if (!z) return;
    var lostParts = r.main.an.parts.filter(function (p) { return p.level === 'lost' && p.from_km >= z.start_km - 1e-6 && p.to_km <= z.end_km + 1e-6; });
    var pts = [];
    lostParts.forEach(function (p) { pts = pts.concat(p.geometry); });
    if (pts.length > 1) {
      S.lastFit = function () { fitBounds(L().latLngBounds(pts), 13); };
      S.lastFit();
    }
    if (isSheet() && S.snap === 'full') applySnap('half');
  }

  /* ---------- TTS ---------- */
  function ttsText() {
    var r = S.result;
    if (!r || !r.main) return '';
    var an = r.main.an;
    if (r.far) {
      var fa = fromLatLng(), fb = toLatLng();
      return t('mp.far.tts', { from: shortName(r.far.side === 'start' ? fromLabel() : destLabel(S.to)), d: km(r.far.km), to: shortName(destLabel(S.to)), air: km(fa && fb ? R().haversineKm(fa, fb) : r.far.km) }) + ' ' + t('mp.tts.end');
    }
    var parts = [t('mp.tts.intro', { strategy: r.source === 'online' ? t('mp.tts.online') : t('mp.strategy.' + S.strategy).toLowerCase(), from: shortName(fromLabel()), to: shortName(destLabel(S.to)), km: km(r.total), eta: dur(etaMin(r.total)), mode: t('mp.mode.' + S.mode).toLowerCase() })];
    var via = viaList(an, 4);
    if (via.length) parts.push(t('mp.tts.via', { list: via.join(', ') }));
    parts.push(t('mp.tts.levels', { likely: km(an.likely_km), uncertain: km(an.uncertain_km), lost: km(an.lost_km) }));
    if (unknownKm(r) > 0.3) parts.push(t('mp.tts.unknown', { km: km(unknownKm(r)) }));
    parts.push(an.zones.length ? t('mp.tts.dz', { x: km(an.zones[0].start_km + (r.startOff > 0.3 ? r.startOff : 0)), y: km(an.zones[0].length_km) }) : t('mp.tts.nodz'));
    parts.push(t('mp.tts.end'));
    return parts.join(' ');
  }
  function stopSpeaking() {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (S.speaking) { S.speaking = false; renderResult(); }
  }
  function speak() {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) { toast(t('mp.tts.unsupported'), { type: 'warning' }); return; }
    if (S.speaking) { stopSpeaking(); return; }
    var text = ttsText();
    if (!text) return;
    var code = lang() === 'en' ? 'en-US' : 'vi-VN';
    var u = new window.SpeechSynthesisUtterance(text);
    u.lang = code;
    u.rate = 0.98;
    var voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var v = voices.filter(function (x) { return x.lang && x.lang.toLowerCase().indexOf(code.slice(0, 2)) === 0; })[0];
    if (v) u.voice = v;
    else if (voices.length && lang() === 'vi') toast(t('mp.tts.no_voice'), { type: 'info', timeout: 2600 });
    u.onend = u.onerror = function () { if (S.speaking) { S.speaking = false; renderResult(); } };
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { toast(t('mp.tts.unsupported'), { type: 'warning' }); return; }
    S.speaking = true;
    renderResult();
  }

  /* ---------- sheets ---------- */
  function openRouteSheet() {
    var routes = seedRoutes();
    var list = U.h('div', { class: 'list list--card mp-rsheet', role: 'radiogroup', 'aria-label': t('mp.rt.title') });
    var ctrl;
    routes.forEach(function (r) {
      var on = r.id === S.routeId;
      var nFac = (window.NC_SEED.facilities || []).filter(function (f) { return f.route_id === r.id && f.status === 'verified'; }).length;
      var item = U.h('button', { type: 'button', class: 'list-item mp-rsheet__item' + (on ? ' is-selected' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false' });
      item.innerHTML = '<span class="list-item__icon icon-tile icon-tile--' + (on ? 'solid' : 'primary') + '">' + ic(MODE_ICON[r.travel_mode] || 'route') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + esc(lang() === 'en' && r.name_en ? r.name_en : r.name) + '</span>' +
        '<span class="list-item__meta">' + esc(t('mp.rt.meta', { region: '\u0001', km: km(r.length_km), n: nFac })).replace('\u0001', function () { return regionHtml(r); }) + '</span></span>' +
        '<span class="list-item__trail">' + (on ? ic('check-circle', 'text-primary') : ic('chevron-right')) + '</span>';
      item.addEventListener('click', function () {
        ctrl.close();
        selectRoute(r.id);
      });
      list.appendChild(item);
    });
    ctrl = NC.ui.sheet({ title: t('mp.rt.title'), subtitle: t('mp.rt.sub'), icon: 'route', size: 'sm', body: list });
  }
  function selectRoute(id) {
    var changed = id !== S.routeId;
    S.routeId = id;
    var r = routeMeta(id);
    if (r && r.travel_mode && MODE_ICON[r.travel_mode] && r.travel_mode !== S.mode) setMode(r.travel_mode);
    if (NC.settings && NC.settings.get('route_id') !== id) NC.settings.set('route_id', id);
    if (changed) {
      var fromRoute = S.from !== 'me' && typeof S.from === 'string' && node(S.from) ? node(S.from).route_id : null;
      if (fromRoute && fromRoute !== id) S.from = 'me';
      if (S.result && S.result.routeId !== id) { S.to = null; computeRoute({ silent: true, fit: false }); drawPois(); }
      toast(t('mp.rt.changed', { name: shortName(routeName(id)) }), { type: 'success', timeout: 1800 });
    }
    renderAll();
    if (S.result && S.result.main) fitResult(); else fitRoute();
  }

  function openSimSheet() {
    if (!S.graph) return;
    var body = U.h('div', { class: 'mp-simsheet' });
    var ctrl;
    var html = '<button class="btn btn--outline btn--block" type="button" data-sim="gps">' + ic('locate') + '<span>' + esc(t('mp.sim.gps')) + '</span></button>';
    routeIdsOrdered().forEach(function (rid) {
      var nodes = routeNodes(rid);
      if (!nodes.length) return;
      html += '<p class="mp-sub">' + esc(shortName(routeName(rid))) + '</p><div class="list list--card">';
      nodes.forEach(function (n) {
        var on = S.pos && R().haversineKm(S.pos, n) < 0.05;
        html += '<button class="list-item" type="button" data-sim="' + esc(n.id) + '">' +
          '<span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + (on ? 'solid' : 'neutral') + '">' + ic(KIND_ICON[n.kind] || 'map-pin') + '</span>' +
          '<span class="list-item__body"><span class="list-item__title">' + esc(nodeName(n)) + '</span><span class="list-item__meta">' + esc(t('mp.kind.' + n.kind)) + '</span></span>' +
          (on ? '<span class="list-item__trail">' + NC.ui.badge(t('mp.sim.current'), 'primary') + '</span>' : '') + '</button>';
      });
      html += '</div>';
    });
    body.innerHTML = html;
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-sim]') : null;
      if (!b) return;
      var v = b.getAttribute('data-sim');
      ctrl.close();
      if (v === 'gps') { locate(S.root.querySelector('[data-mp="locate"]')); return; }
      var n = node(v);
      if (!n) return;
      setPos({ lat: n.lat, lng: n.lng, source: 'sim' }, { fly: !S.to });
      if (n.route_id && n.route_id !== S.routeId) selectRoute(n.route_id);
      toast(t('mp.pos.set', { name: shortName(nodeName(n)) }), { type: 'success', timeout: 2000 });
    });
    ctrl = NC.ui.sheet({ title: t('mp.sim.title'), subtitle: t('mp.sim.sub'), icon: 'crosshair', size: 'md', body: body });
  }

  function reportToast(op) {
    var online = NC.net ? NC.net.online() : true;
    toast(t(online ? 'mp.rep.sent' : 'mp.rep.queued'), { type: online ? 'success' : 'warning' });
    return op;
  }

  function openReportSheet(id) {
    var f = facById(id);
    if (!f || !NC.data) return;
    var keys = ['phone', 'hours', 'location', 'closed', 'capability', 'other'];
    var body = U.h('div', { class: 'stack mp-form' });
    body.innerHTML = '<div class="mp-form__target">' + sheetIconTile(f.type) + '<span><b>' + esc(f.name) + '</b><small>' + esc(t('mp.type.' + f.type)) + '</small></span></div>' +
      '<fieldset class="mp-form__set"><legend class="field__label">' + esc(t('mp.rep.what')) + '</legend><div class="chip-group">' +
      keys.map(function (k) { return '<button class="chip" type="button" data-rep="' + k + '" aria-pressed="false">' + esc(t('mp.rep.' + k)) + '</button>'; }).join('') +
      '</div><p class="field__error" data-err hidden>' + esc(t('mp.rep.pick')) + '</p></fieldset>' +
      '<label class="field"><span class="field__label">' + esc(t('mp.rep.note')) + ' <small class="muted">(' + esc(t('common.optional')) + ')</small></span>' +
      '<textarea class="textarea" maxlength="500" data-note placeholder="' + esc(t('mp.rep.note_ph')) + '"></textarea></label>';
    body.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-rep]') : null;
      if (!c) return;
      c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      body.querySelector('[data-err]').hidden = true;
    });
    NC.ui.sheet({
      title: t('mp.rep.title'), icon: 'flag', iconVariant: 'warning', size: 'sm', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('mp.rep.send'), variant: 'primary', icon: 'send',
          onClick: function () {
            var picked = U.$$('[data-rep][aria-pressed="true"]', body).map(function (b) { return b.getAttribute('data-rep'); });
            if (!picked.length) { body.querySelector('[data-err]').hidden = false; return false; }
            var note = body.querySelector('[data-note]').value.trim();
            var text = picked.map(function (k) { return t('mp.rep.' + k); }).join(', ') + (note ? ' — ' + note : '');
            return NC.data.submitReport({
              kind: picked.indexOf('closed') >= 0 ? 'closed' : 'correction', facility_id: f.id, name: f.name, type: f.type,
              lat: f.lat, lng: f.lng, note: text, route_id: f.route_id || S.routeId
            }).then(reportToast).catch(function () { toast(t('common.error'), { type: 'danger' }); return false; });
          }
        }
      ]
    });
  }

  function openProposeSheet(p) {
    if (!p || !NC.data) return;
    var body = U.h('div', { class: 'stack mp-form' });
    body.innerHTML = '<label class="field"><span class="field__label">' + esc(t('mp.new.name')) + ' <span class="req">*</span></span>' +
      '<input class="input" type="text" maxlength="120" data-name autocomplete="off"><span class="field__error" data-err hidden>' + esc(t('mp.new.need_name')) + '</span></label>' +
      '<label class="field"><span class="field__label">' + esc(t('mp.new.type')) + '</span><select class="select" data-type>' +
      FAC_TYPES.map(function (ty) { return '<option value="' + ty + '"' + (ty === 'tram_y_te' ? ' selected' : '') + '>' + esc(t('mp.type.' + ty)) + '</option>'; }).join('') + '</select></label>' +
      '<div class="kv"><div class="kv__row"><dt>' + esc(t('mp.new.coords')) + '</dt><dd class="mono">' + esc(coordText(p)) + '</dd></div></div>' +
      '<label class="field"><span class="field__label">' + esc(t('mp.rep.note')) + ' <small class="muted">(' + esc(t('common.optional')) + ')</small></span>' +
      '<textarea class="textarea" maxlength="500" data-note></textarea></label>';
    NC.ui.sheet({
      title: t('mp.new.title'), subtitle: t('mp.new.sub'), icon: 'plus', size: 'sm', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('mp.new.send'), variant: 'primary', icon: 'send',
          onClick: function () {
            var name = body.querySelector('[data-name]').value.trim();
            if (!name) { body.querySelector('[data-err]').hidden = false; body.querySelector('[data-name]').focus(); return false; }
            return NC.data.submitReport({
              kind: 'new', name: name, type: body.querySelector('[data-type]').value, lat: p.lat, lng: p.lng,
              note: body.querySelector('[data-note]').value.trim() || null, route_id: S.routeId
            }).then(reportToast).catch(function () { toast(t('common.error'), { type: 'danger' }); return false; });
          }
        }
      ]
    });
  }

  function confirmRemove(rid, car) {
    NC.ui.confirm({
      title: t('mp.pk.remove_q', { route: shortName(routeName(rid)), carrier: carrierName(car) }),
      message: t('mp.pk.remove_msg'), confirmLabel: t('common.delete'), danger: true
    }).then(function (ok) {
      if (!ok) return;
      NC.data.removePack(rid, car).then(function () {
        var online = NC.net ? NC.net.online() : navigator.onLine !== false;
        toast(t(online ? 'mp.pk.removed_online' : 'mp.pk.removed'), { type: 'success' });
      });
    });
  }

  function downloadPack(rid, btn) {
    if (!NC.data) return;
    if (NC.net && !NC.net.online()) { toast(t('mp.pk.offline'), { type: 'warning' }); return; }
    NC.ui.setLoading(btn, true);
    NC.data.downloadPack(rid, S.carrier).then(function (meta) {
      toast(t('mp.pk.done', { route: shortName(routeName(rid)), carrier: carrierName(S.carrier), size: U.fmtBytes(meta.size_bytes) }), { type: 'success' });
    }).catch(function (e) {
      toast(e && e.code === 'offline' ? t('mp.pk.offline') : t('mp.pk.fail'), { type: 'warning' });
    }).then(function () { if (btn && btn.isConnected !== false) NC.ui.setLoading(btn, false); });
  }

  /* Offline vector basemap (NC.basemap): download / remove one corridor from the packs tab. */
  function downloadBasemap(rid, btn) {
    if (!NC.basemap || !rid) return;
    if (NC.net && !NC.net.online()) { toast(t('bm.offline'), { type: 'warning' }); return; }
    NC.ui.setLoading(btn, true);
    NC.basemap.downloadWithFeedback(rid).then(function () {
      if (btn && btn.isConnected !== false) NC.ui.setLoading(btn, false);
    });
  }
  function confirmRemoveBasemap(rid) {
    if (!NC.basemap || !rid) return;
    NC.ui.confirm({
      title: t('mp.bm.remove_q', { route: shortName(routeName(rid)) }),
      message: t('mp.bm.remove_msg'), confirmLabel: t('common.delete'), danger: true
    }).then(function (ok) { if (ok) NC.basemap.removeWithFeedback(rid); });
  }

  /* ---------- delegated clicks ---------- */
  function onAction(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-mp], [data-layer], [data-tab]') : null;
    if (!el) return;
    if (el.hasAttribute('data-layer')) {
      var k = el.getAttribute('data-layer');
      if (k === 'vbase') { toggleVbase(); return; }
      S.layers[k] = !S.layers[k];
      el.setAttribute('aria-pressed', S.layers[k] ? 'true' : 'false');
      persistUi();
      drawAll();
      renderLayers();
      return;
    }
    if (el.getAttribute('role') === 'tab') { setTab(el.getAttribute('data-tab')); return; }
    var a = el.getAttribute('data-mp');
    var id = el.getAttribute('data-id');
    switch (a) {
      case 'layers-menu': toggleLayers(undefined, e.detail === 0); break;
      case 'legend': toggleLegend(); break;
      case 'locate': locate(el); break;
      case 'sim': openSimSheet(); break;
      case 'fit': fitResult(); break;
      case 'route-sheet': openRouteSheet(); break;
      case 'swap': swapEnds(); break;
      case 'to-clear': S.els.to.value = ''; closeCombo('to'); S.to = null; computeRoute({ fit: false }); drawPois(); break;
      case 'to-nearest': toNearestCare(); break;
      case 'preset': S.from = el.getAttribute('data-from'); setDest({ kind: 'node', id: el.getAttribute('data-to') }); break;
      case 'strategy': setStrategy(el.getAttribute('data-v')); break;
      case 'zone': zoomZone(+el.getAttribute('data-i') || 0); break;
      case 'trip-start': startTrip(el); break;
      case 'trip-stop': stopTrip(el); break;
      case 'trip-share': shareLocation(); break;
      case 'geo-enable': enableGeo(el); break;
      case 'geo-real': if (NC.geo && NC.geo.useReal) NC.geo.useReal().then(function () { renderGeoHint(); }); break;
      case 'online-ok': Promise.resolve(NC.geoOnline && NC.geoOnline.accept()).then(function () { computeRoute(); }); break;
      case 'online-retry': computeRoute({ retry: true }); break;
      case 'pick-cancel': stopPick(); break;
      case 'need-from': if (S.cb.from) S.cb.from.input.focus(); break;
      case 'from-clear': S.from = 'me'; if (S.cb.from) S.cb.from.input.value = fieldLabel('from'); closeCombo('from'); S.partsOpen = false; computeRoute({ fit: false }); break;
      case 'speak': speak(); break;
      case 'clear-route': stopSpeaking(); S.to = null; S.els.to.value = ''; S.moreOpen = false; computeRoute({ fit: false }); drawPois(); fitRoute(); break;
      case 'parts-more': S.partsOpen = !S.partsOpen; renderResult(); break;
      case 'tab': setTab(el.getAttribute('data-tab')); break;
      case 'fac-dir': case 'svc-dir': {
        var tgt = a === 'fac-dir' ? facById(id) : svcById(id);
        if (!tgt) break;
        if (S.pos) S.from = 'me';
        if (S.map) S.map.closePopup();
        setDest({ kind: a === 'fac-dir' ? 'fac' : 'svc', id: id, lat: tgt.lat, lng: tgt.lng });
        break;
      }
      case 'fac-report': openReportSheet(id); break;
      case 'call': NC.ui.callNumber(el.getAttribute('data-phone')); break;
      case 'node-to': if (S.map) S.map.closePopup(); setDest({ kind: 'node', id: id }); break;
      case 'node-from': if (S.map) S.map.closePopup(); setFrom(id); break;
      case 'node-pos': {
        var n = node(id);
        if (S.map) S.map.closePopup();
        if (n) { setPos({ lat: n.lat, lng: n.lng, source: 'sim' }); toast(t('mp.pos.set', { name: shortName(nodeName(n)) }), { type: 'success', timeout: 2000 }); }
        break;
      }
      case 'ctx-pos': if (S.map) S.map.closePopup(); if (ctxPoint) { setPos(Object.assign({ source: 'sim' }, ctxPoint), { nofit: true }); toast(t('mp.pos.set', { name: placeLabel(ctxPoint) }), { type: 'success', timeout: 2000 }); } break;
      case 'ctx-to': if (S.map) S.map.closePopup(); if (ctxPoint) setDest({ kind: 'point', lat: ctxPoint.lat, lng: ctxPoint.lng }); break;
      case 'ctx-from': if (S.map) S.map.closePopup(); if (ctxPoint) setFrom({ lat: ctxPoint.lat, lng: ctxPoint.lng }); break;
      case 'ctx-new': if (S.map) S.map.closePopup(); openProposeSheet(ctxPoint); break;
      case 'med-type': S.medType = el.getAttribute('data-type') || 'all'; renderMed(); break;
      case 'med-trauma': S.traumaOnly = !S.traumaOnly; renderMed(); break;
      case 'pk-download': downloadPack(el.getAttribute('data-route'), el); break;
      case 'pk-remove': confirmRemove(el.getAttribute('data-route'), el.getAttribute('data-carrier')); break;
      case 'bm-download': downloadBasemap(el.getAttribute('data-route'), el); break;
      case 'bm-remove': confirmRemoveBasemap(el.getAttribute('data-route')); break;
      case 'far-dismiss': S.farDismissed = true; renderFar(); break;
      default: break;
    }
  }

  /* Swap start and destination, keeping each end's identity: 'me' stays the live position, nodes/facilities keep names. */
  function swapEnds() {
    var f = S.from, d = S.to;
    if (!d) return;
    var newFrom;
    if (d.kind === 'me') newFrom = 'me';
    else if (d.kind === 'node') newFrom = d.id;
    else newFrom = { kind: d.kind, id: d.id || null, lat: d.lat, lng: d.lng, label: d.label || null };
    var newTo;
    if (f === 'me') newTo = { kind: 'me' };
    else if (f && typeof f === 'object') newTo = { kind: f.kind && f.kind !== 'me' ? f.kind : 'point', id: f.id || null, lat: f.lat, lng: f.lng, label: f.label || null };
    else if (node(f)) newTo = { kind: 'node', id: f };
    else return;
    if (newFrom === 'me' && !S.pos) return;
    S.from = newFrom;
    S.to = newTo;
    S.partsOpen = false;
    computeRoute();
    drawPois();
  }

  /* ================================================================== wiring */
  function collectEls(root) {
    var q = function (id) { return root.querySelector('#' + id); };
    S.els = {
      map: q('mp-map'), top: q('mp-top'), routeChip: q('mp-route-chip'), routeName: q('mp-route-chip-name'), carrierName: q('mp-carrier-name'),
      far: q('mp-far'), panel: q('mp-panel'), ptop: q('mp-panel-top'), grip: q('mp-grip'), summary: q('mp-summary'), tabs: q('mp-tabs'),
      body: q('mp-panel-body'), from: q('mp-from'), to: q('mp-to'), toList: q('mp-to-list'), toClear: q('mp-to-clear'),
      presets: q('mp-presets'), result: q('mp-result'), medPos: q('mp-med-pos'), medFilter: q('mp-med-filter'), medList: q('mp-med-list'),
      medDisc: q('mp-med-disclaimer'), stops: q('mp-stops'), packs: q('mp-packs'),
      layersBtn: q('mp-layers-btn'), layersPanel: q('mp-layers-panel'), demo: q('mp-demo'), demoStatus: q('mp-demo-status'),
      legend: q('mp-legend'), legendBtn: q('mp-legend-btn'),
      fromList: q('mp-from-list'), fromClear: q('mp-from-clear'), geoHint: q('mp-geo-hint'), pick: q('mp-pick')
    };
    // screen-reader status of the comboboxes (online search loading / results / nothing / error; listbox info rows
    // are presentation only)
    var plan = root.querySelector('#mp-plan');
    var live = root.querySelector('#mp-combo-live');
    if (!live && plan) {
      live = document.createElement('p');
      live.id = 'mp-combo-live';
      live.className = 'visually-hidden';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      plan.appendChild(live);
    }
    S.els.comboLive = live;
    S.cb = {
      from: S.els.from ? { which: 'from', input: S.els.from, list: S.els.fromList, clear: S.els.fromClear, items: [], active: -1, offline: 0 } : null,
      to: S.els.to ? { which: 'to', input: S.els.to, list: S.els.toList, clear: S.els.toClear, items: [], active: -1, offline: 0 } : null
    };
  }

  function wire() {
    var root = S.root;
    root.addEventListener('click', onAction);
    // tabs keyboard
    S.els.tabs.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
      var tabs = U.$$('[role="tab"]', S.els.tabs);
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[n].focus();
      setTab(tabs[n].getAttribute('data-tab'));
    });
    // From + To comboboxes (offline + online search)
    wireCombo('from');
    wireCombo('to');
    // segmented controls
    S.segMode = NC.ui.segmented(root.querySelector('#mp-mode'), { value: S.mode, onChange: function (v) { setMode(v); } });
    S.segStrat = NC.ui.segmented(root.querySelector('#mp-strategy'), { value: S.strategy, onChange: setStrategy });
    // route chip
    S.els.routeChip.addEventListener('click', openRouteSheet);
    // overflow:hidden containers can still be scrolled by focus/scrollIntoView → keep the stage pinned
    root.addEventListener('scroll', function () { if (root.scrollTop || root.scrollLeft) { root.scrollTop = 0; root.scrollLeft = 0; } });
    // keyboard focus inside the collapsed phone panel → expand it so the focused control is visible
    S.els.body.addEventListener('focusin', function (e) {
      if (!isSheet() || S.snap === 'full') return;
      var kb = false;
      try { kb = e.target.matches(':focus-visible'); } catch (err) { kb = false; }
      if (kb) applySnap('full');
    });
    wireDrag();
    // layout
    var onResize = U.debounce(function () {
      if (!S.shown) return;
      applySnap(S.snap);
      if (S.map) S.map.invalidateSize(false);
      syncFade(S.els.medFilter);
    }, 120);
    window.addEventListener('resize', onResize);
    if (S.els.medFilter) S.els.medFilter.addEventListener('scroll', function () { syncFade(S.els.medFilter); }, { passive: true });
    if (mqSheet) {
      var onMq = function () { toggleLegend(false); applySnap(S.snap); if (S.map) NC.mapkit.refresh(S.map); };
      if (mqSheet.addEventListener) mqSheet.addEventListener('change', onMq); else if (mqSheet.addListener) mqSheet.addListener(onMq);
    }
  }

  function wireBus() {
    if (!NC.bus) return;
    NC.bus.on('settings:change', function (p) {
      if (!p || !S.mounted) return;
      if (p.key === 'carrier' && p.value !== S.carrier) { S.carrier = p.value; renderChips(); loadGraph(); if (S.tab === 'packs') renderPacks(); }
      else if (p.key === 'route_id' && p.value && p.value !== S.routeId) { selectRoute(p.value); }
      else if (p.key === 'travel_mode' && p.value !== S.mode && MODE_ICON[p.value]) setMode(p.value, { fromSetting: true });
      else if (p.key === 'community_logs' && S.tab === 'packs') renderPacks();
      else if (p.key === 'last_position' && p.value !== S._ownPos) {
        var v = p.value;
        if (v && isFinite(v.lat) && (!S.pos || Math.abs(v.lat - S.pos.lat) > 1e-7 || Math.abs(v.lng - S.pos.lng) > 1e-7)) {
          S.pos = v; drawUser(); checkFar(); renderChips();
          if ((S.from === 'me' && S.to) || endIsMe('to')) computeRoute({ fit: false, silent: true });
          else renderPlanner();
          if (S.tab === 'med') renderMed();
        }
      }
    });
    // Pack indicator stays live: own downloads/removals (data:pack), admin publishes (server:change data_packs, local
    // backend realtime), connectivity changes; the graph reloads first so rows show the source now in use.
    var packsChanged = function () {
      if (!S.mounted) return;
      Promise.resolve(loadGraph()).then(function () { if (S.tab === 'packs') renderPacks(); });
    };
    NC.bus.on('data:pack', packsChanged);
    // offline vector basemap downloaded / removed (packs tab, suggestion sheet): the attach() controller re-syncs itself
    NC.bus.on('basemap:change', function () {
      if (!S.mounted) return;
      renderLayers();
      if (S.tab === 'packs') renderPacks();
    });
    NC.bus.on('server:change', function (m) {
      if (m && (m.table === 'data_packs' || m.table === '*')) setTimeout(packsChanged, 0); // after dataservice drops its memo
    });
    // Server copies are only used while online (contract §8): going offline swaps them for downloaded/bundled packs,
    // coming back online picks up the server versions again.
    NC.bus.on('net:change', function () {
      if (!S.mounted) return;
      var on = NC.net ? NC.net.online() : true;
      var changed = on !== S.wasOnline;
      S.wasOnline = on;
      if (changed && on) S.onlineFail = []; // back online: failed online routes may be requested again
      var usesServer = Object.keys(S.packs).some(function (k) { return S.packs[k] && S.packs[k].source === 'server'; });
      if (changed && (on || usesServer)) packsChanged();
      else if (S.tab === 'packs') renderPacks();
    });
    // Supabase realtime only reaches admins → poll the (cheap) route list while the packs tab is on screen.
    setInterval(function () {
      if (S.shown && S.tab === 'packs' && (!document.visibilityState || document.visibilityState === 'visible') && (!NC.net || NC.net.online())) renderPacks();
    }, 60000);
    // the active trip (NC.trip) → "Bắt đầu đi" / "Đang đi · Kết thúc" on the route card
    NC.bus.on('trip:update', function () {
      if (!S.mounted) return;
      if (S.result && S.result.main) renderResult();
    });
    NC.bus.on('geo:permission', function (p) {
      if (!S.mounted || !p) return;
      S.geoPerm = p.state;
      renderGeoHint();
    });
    NC.bus.on('geo:demo', function () { if (S.mounted) renderGeoHint(); });
    NC.bus.on('i18n:change', function () {
      if (!S.mounted) return;
      renderAll();
      if (S.map && S.graph) { drawNodes(); drawResult(); }
    });
  }

  /* ================================================================== screen lifecycle */
  function mount(section) {
    var root = section.querySelector('#mp-root');
    if (!root) {
      section.appendChild(NC.ui.emptyState({ icon: 'map', variant: 'warning', title: t('app.title.map'), text: t('mp.error') }));
      return;
    }
    S.root = root;
    collectEls(root);
    if (NC.settings) {
      S.carrier = NC.settings.get('carrier') || S.carrier;
      S.routeId = NC.settings.get('route_id') || S.routeId;
      S.mode = MODE_ICON[NC.settings.get('travel_mode')] ? NC.settings.get('travel_mode') : S.mode;
      var lp = NC.settings.get('last_position');
      S.pos = lp && isFinite(lp.lat) && isFinite(lp.lng) ? lp : null;
    }
    S.snap = 'peek'; // side layout ignores it; entering the phone sheet later re-picks it (applySnap → entrySnap)
    S.wasOnline = NC.net ? NC.net.online() : true;
    wire();
    wireBus();
    S.mounted = true;
    NC.i18n.apply(root);
    renderChips();
    renderSummary();
    renderResult();
    refreshGeoPerm();
    var ui = NC.store ? NC.store.get(KV_UI).catch(function () { return null; }) : Promise.resolve(null);
    S.uiReady = ui.then(function (u) {
      if (!u) return;
      if (u.strategy === 'shortest' || u.strategy === 'signal') S.strategy = u.strategy;
      if (u.layers) Object.keys(S.layers).forEach(function (k) { if (typeof u.layers[k] === 'boolean') S.layers[k] = u.layers[k]; });
      if (u.tab) S.tab = u.tab;
      if (u.vbase === 'on') { S.vbaseMode = 'on'; if (S.bm) S.bm.setMode('on'); }
    });
    S.uiReady.then(function () { setTab(S.tab, { silent: true, keepSnap: true }); return loadGraph(); });
  }

  function show(params) {
    if (!S.mounted) return;
    params = params || {};
    S.shown = true;
    var hasMap = ensureMap();
    if (hasMap) NC.mapkit.refresh(S.map);
    if (hasMap) releaseTiles(2500); // safety net: the first fit normally releases them much earlier
    var wantSnap = SNAPS.indexOf(params.snap) >= 0 ? params.snap : null;
    applySnap(wantSnap || S.snap);
    requestAnimationFrame(function () { applySnap(S.snap); });
    Promise.resolve(S.uiReady).then(function () { return S.loading; }).then(function () {
      if (!S.graph) return null;
      drawAll();
      return applyParams(params, wantSnap);
    });
  }

  /* Phones: a route on screen opens the panel to half (map-first 'peek' otherwise). */
  function snapForRoute(wantSnap) {
    if (isSheet() && !wantSnap && S.snap === 'peek' && S.result && S.result.main) applySnap('half');
  }

  function applyParams(p, wantSnap) {
    var hadTarget = false;
    if (p.route && routeMeta(p.route) && p.route !== S.routeId) selectRoute(p.route);
    if (p.mode && MODE_ICON[p.mode]) setMode(p.mode);
    if (p.strategy === 'shortest' || p.strategy === 'signal') S.strategy = p.strategy;
    if (p.from) S.from = p.from === 'me' || !node(p.from) ? 'me' : p.from;
    if (p.to) {
      var d = destFor(p.to);
      if (d) { S.to = d; hadTarget = true; }
    }
    if (p.tab) setTab(p.tab, { silent: true, keepSnap: true });
    if (hadTarget || p.from || p.strategy) {
      S.partsOpen = false;
      computeRoute({ silent: !hadTarget, fit: false });
      drawPois();
      if (hadTarget && !p.tab) setTab('route', { silent: true, keepSnap: true });
      snapForRoute(wantSnap);
      fitResult();
      return null;
    }
    return restoreLast().then(function (restored) {
      if (restored) drawPois();
      snapForRoute(wantSnap);
      fitResult();
    });
  }

  function hide() {
    S.shown = false;
    clearInterval(S.focusT);
    S.focusIntent = null;
    toggleLayers(false);
    toggleLegend(false);
    stopPick();
    closeCombo();
    stopSpeaking();
    if (S.map) S.map.closePopup();
  }

  NC.app.register('map', { titleKey: 'app.title.map', shortTitleKey: 'app.title_short.map', mod: 'MOD.02', icon: 'map', mount: mount, show: show, hide: hide });

  /* ================================================================== public API */
  NC.map = {
    /** Open the map screen. params: {to, from, strategy, mode, route, tab, snap}. */
    open: function (params) { NC.app.go('map', params || null); },
    /**
     * Compute a route programmatically (both strategies) and display it when the screen is mounted.
     * @param {string|{lat,lng}} from node id, 'me' or point; @param {string} to node/facility id
     * @returns {Promise<Object|null>} {length_km, lost_km, first_lost_at_km, strategy, route_id}
     */
    route: function (from, to, opts) {
      opts = opts || {};
      return Promise.resolve(S.loading).then(function () {
        if (!S.graph) return null;
        if (opts.strategy) S.strategy = opts.strategy;
        S.from = from === 'me' ? 'me' : (typeof from === 'object' ? from : (node(from) ? from : 'me'));
        var d = typeof to === 'string' ? destFor(to) : (to && isFinite(to.lat) ? { kind: 'point', lat: to.lat, lng: to.lng } : null);
        if (!d) return null;
        setDest(d);
        var r = S.result;
        return r && r.main ? { length_km: r.main.an.length_km, lost_km: r.main.an.lost_km, first_lost_at_km: r.main.an.first_lost_at_km, strategy: S.strategy, route_id: r.routeId } : null;
      });
    },
    /**
     * Care facilities ranked by road distance from a point (same ranking as the "Cơ sở y tế gần nhất" preset).
     * @param {{lat:number,lng:number}} p
     * @returns {Promise<{nearest:Object|null, pick:Object|null, far_km:number|null, list:Array<{id,name,road_km,air_km}>}>}
     */
    nearestCare: function (p, opts) {
      return Promise.resolve(S.loading).then(function () {
        if (!S.graph || !p || !NC.data) return null;
        return NC.data.nearestFacilities(p, { limit: 60, types: (opts && opts.types) || CARE_TYPES }).then(function (list) {
          var rk = rankCare(p, list || [], { k: (opts && opts.k) || 1 });
          var row = function (r) { return r ? { id: r.f.id, name: r.f.name, road_km: r.road ? r.road.km : null, air_km: r.f.distance_km } : null; };
          return { nearest: row(rk.nearest), pick: row(rk.pick), far_km: rk.far, list: rk.list.map(row) };
        });
      });
    },
    /** The Leaflet map instance (null until the screen was shown) — test/debug hook. */
    leaflet: function () { return S.map; },
    /** Current fit padding + floating-overlay boxes (map-container px) — test/debug hook. */
    overlays: function () { return S.map ? { pads: pads(), ov: overlayRects() } : null; },
    /** Last saved route (kv 'map.last_route'). */
    lastRoute: function () { return NC.store ? NC.store.get(KV_LAST) : Promise.resolve(null); },
    /** Debug/test snapshot. */
    state: function () {
      var r = S.result;
      return {
        carrier: S.carrier, route_id: S.routeId, mode: S.mode, strategy: S.strategy, tab: S.tab, snap: S.snap, layers: Object.assign({}, S.layers),
        pos: S.pos, from: S.from, to: S.to, graph: !!S.graph, facilities: S.facilities.length, geoPerm: S.geoPerm, picking: S.picking,
        result: r && r.main ? {
          source: r.source || 'offline', gate: r.gate || null, length_km: r.main.an.length_km, lost_km: r.main.an.lost_km,
          unknown_km: r.main.an.unknown_km || 0, zones: r.main.an.zones.length, parts: r.main.an.parts.length, route_id: r.routeId || null,
          other: r.other ? { strategy: r.other.strategy, length_km: r.other.an.length_km, lost_km: r.other.an.lost_km } : null, same: r.same, stops: r.stops.length,
          plan: r.plan ? { route_key: r.plan.route_key, points: r.plan.geometry.length, zones: r.plan.zones.length, length_km: r.plan.length_km, unknown_km: r.plan.unknown_km } : null
        } : (r ? { none: !!r.none, gate: r.gate || null, needFrom: !!r.needFrom, err: r.err || null } : null)
      };
    }
  };
})(window.NC = window.NC || {});
