/*
 * config.js — Cấu hình triển khai NomadCare (owner: P1 data).
 * Public API: window.NC_CONFIG (đọc bởi NC.data, NC.mapkit, app shell). File này KHÔNG chứa bí mật.
 * Để trống supabaseUrl/supabaseAnonKey => ứng dụng chạy ở chế độ CỤC BỘ (máy chủ mô phỏng trong trình duyệt).
 */
(function (root) {
  'use strict';

  root.NC_CONFIG = {
    /*
     * Kết nối Supabase (tầng máy chủ: PostgreSQL + PostGIS).
     * Lấy tại Supabase Dashboard → Project Settings → API:
     *   - supabaseUrl     : "Project URL", ví dụ 'https://abcdxyz.supabase.co'
     *   - supabaseAnonKey : khoá "anon public" (được phép công khai; mọi quyền ghi của thiết bị
     *                       đi qua các hàm RPC SECURITY DEFINER, bảng dữ liệu đã bật RLS).
     * TUYỆT ĐỐI không dán khoá "service_role" vào đây.
     */
    supabaseUrl: '',
    supabaseAnonKey: '',

    /*
     * URL gốc của Edge Functions (dùng cho nút "Gửi cảnh báo ngay" trong trang quản trị).
     * Thường là '<supabaseUrl>/functions/v1'. Để trống => tự suy ra từ supabaseUrl.
     */
    functionsUrl: '',

    /*
     * Web Push cho lời nhắc trước vùng mất sóng (round 2 R6) — chỉ ở chế độ Supabase.
     * Khoá VAPID CÔNG KHAI (base64url, tạo một lần: `npx web-push generate-vapid-keys`); khoá bí mật chỉ đặt
     * trong secret VAPID_PRIVATE_KEY của Edge Function push-dispatch, KHÔNG dán vào đây.
     * Để trống => không dùng push: lời nhắc chỉ hiện khi ứng dụng đang mở (hẹn giờ trong máy).
     */
    vapidPublicKey: '',

    /* Phiên bản ứng dụng và phiên bản nội dung y tế đóng gói kèm (hiển thị ở Cài đặt). */
    appVersion: '2.0.0',
    contentVersion: '1.1.0-demo',

    /* Cung đường và nhà mạng mặc định khi người dùng chưa chọn (id theo bảng routes/carriers). */
    defaultRoute: 'ha-giang-loop',
    defaultCarrier: 'viettel',

    /*
     * true => luôn dùng máy chủ mô phỏng cục bộ dù đã điền khoá Supabase
     * (tiện khi demo không có mạng). Có thể ép tạm thời bằng URL ?backend=local.
     */
    forceLocal: false,

    /*
     * Bản đồ nền raster (cần mạng). Mặc định CARTO Voyager (sáng) / Dark Matter (tối),
     * dữ liệu © OpenStreetMap contributors © CARTO. Có thể thay bằng máy chủ tile riêng.
     * LƯU Ý: từ 23/09/2026 CARTO yêu cầu API key (miễn phí, xin tại https://carto.com/basemaps/apikey),
     * nếu thiếu sẽ hiện hình mờ "API key required". Khi có khoá, thêm vào cuối cả hai URL:
     *   '...{y}{r}.png?key=KHOÁ_CỦA_BẠN'
     * Khi URL CARTO chưa có khoá, NC.mapkit tự dùng tile OpenStreetMap chuẩn (chế độ tối = đảo màu bằng CSS).
     */
    tiles: {
      light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    },

    /*
     * Tìm địa điểm & dẫn đường TRỰC TUYẾN ngoài 3 tuyến thí điểm (round 2 R4, NC.geoOnline) — chỉ khi có mạng và
     * người dùng đã đồng ý một lần. Dịch vụ công cộng của OpenStreetMap: tối đa 1 yêu cầu/giây, không tự hoàn thành
     * theo từng phím gõ, dữ liệu © OpenStreetMap contributors. Có thể thay bằng máy chủ riêng cùng API.
     *   - nominatimUrl : tìm kiếm (Nominatim /search, format=jsonv2, countrycodes=vn)
     *   - osrmCarUrl   : dẫn đường xe máy (OSRM hồ sơ ô tô của FOSSGIS — OSRM không có hồ sơ xe máy)
     *   - osrmFootUrl  : dẫn đường đi bộ / trekking (OSRM hồ sơ đi bộ của FOSSGIS)
     */
    nominatimUrl: 'https://nominatim.openstreetmap.org/search',
    osrmCarUrl: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    osrmFootUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
  };
})(typeof window !== 'undefined' ? window : globalThis);
