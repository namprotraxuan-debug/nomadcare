"""NomadCare seed — the 3 pilot routes as graphs (nodes + edges to be routed by OSRM).

Node tuple: (id, name_vi, name_en, kind, lat, lng). Coordinates are the requested
waypoints; the builder snaps every node onto the road/trail returned by OSRM.
Edge tuple: (from, to, role[, options]) with role in:
  'main'      part of the canonical route line (routes[].geometry, length_km)
  'alt'       real alternative branch (makes A* meaningful)
  'spur'      side trip to a landmark (still part of the route network)
  'connector' access road to an off-route facility / evacuation road (is_connector = true)
options: {'profile': 'driving'|'foot', 'synth': True (see README: OSM gap), 'via': [(lat, lng)]}
Main edges are listed in travel order; the builder checks they chain end-to-end.
"""

ROUTES = [
    {
        'id': 'khanh-le',
        'sort': 1,
        'name': 'Đèo Khánh Lê (QL27C Đà Lạt – Nha Trang)',
        'name_en': 'Khanh Le Pass (QL27C Da Lat – Nha Trang)',
        'region': 'Lâm Đồng – Khánh Hòa',
        'region_en': 'Lâm Đồng – Khánh Hòa',
        'travel_mode': 'motorbike',
        'color': '#2563EB',
        'profile': 'driving',
        'expect_main_km': (125, 150),
        'description_vi': ('Cung đèo QL27C nối Đà Lạt với Nha Trang, xuyên Vườn quốc gia Bidoup – Núi Bà. '
                           'Khu vực thôn Long Lanh (xã Lạc Dương) và đoạn đèo Khánh Lê nằm trong danh mục '
                           'điểm lõm sóng do Sở KH&CN Lâm Đồng công bố.'),
        'description_en': ('QL27C mountain road from Da Lat to Nha Trang through Bidoup – Nui Ba National Park. '
                           'The Long Lanh hamlet area (Lac Duong commune) and the Khanh Le pass are officially '
                           'listed signal dead zones.'),
        'nodes': [
            ('kl-da-lat', 'Đà Lạt (chợ Đà Lạt)', 'Da Lat (central market)', 'town', 11.94344, 108.43718),
            ('kl-lac-duong', 'Lạc Dương (phường Lang Biang)', 'Lac Duong (Lang Biang ward)', 'town', 12.00930, 108.42611),
            ('kl-da-sar', 'Đạ Sar', 'Da Sar', 'village', 12.075615, 108.522640),
            ('kl-long-lanh', 'Khu vực thôn Long Lanh', 'Long Lanh hamlet area', 'village', 12.13650, 108.62880),
            ('kl-deo-top', 'Đỉnh đèo Khánh Lê (Hòn Giao)', 'Khanh Le pass summit (Hon Giao)', 'pass', 12.18628, 108.71505),
            ('kl-deo-mid', 'Đèo Khánh Lê – khúc cua giữa đèo', 'Khanh Le pass – mid hairpins', 'viewpoint', 12.22175, 108.75544),
            ('kl-lien-sang', 'Liên Sang (chân đèo)', 'Lien Sang (foot of the pass)', 'village', 12.26830, 108.81843),
            ('kl-cau-ba', 'Cầu Bà', 'Cau Ba', 'village', 12.26618, 108.86620),
            ('kl-khanh-vinh', 'Khánh Vĩnh', 'Khanh Vinh', 'town', 12.277755, 108.904431),
            ('kl-dien-khanh', 'Diên Khánh', 'Dien Khanh', 'town', 12.25982, 109.10002),
            ('kl-nha-trang', 'Nha Trang (Tháp Trầm Hương)', 'Nha Trang (Tram Huong tower)', 'town', 12.24055, 109.19693),
            ('kl-khanh-binh', 'Khánh Bình (PKĐK khu vực)', 'Khanh Binh (area clinic)', 'poi', 12.35964, 108.96023),
        ],
        'edges': [
            ('kl-da-lat', 'kl-lac-duong', 'main'),
            ('kl-lac-duong', 'kl-da-sar', 'main'),
            ('kl-da-sar', 'kl-long-lanh', 'main'),
            ('kl-long-lanh', 'kl-deo-top', 'main'),
            ('kl-deo-top', 'kl-deo-mid', 'main'),
            ('kl-deo-mid', 'kl-lien-sang', 'main'),
            ('kl-lien-sang', 'kl-cau-ba', 'main'),
            ('kl-cau-ba', 'kl-khanh-vinh', 'main'),
            ('kl-khanh-vinh', 'kl-dien-khanh', 'main'),
            ('kl-dien-khanh', 'kl-nha-trang', 'main'),
            ('kl-khanh-vinh', 'kl-khanh-binh', 'connector'),
        ],
    },
    {
        'id': 'ta-nang-phan-dung',
        'sort': 2,
        'name': 'Tà Năng – Phan Dũng (trekking)',
        'name_en': 'Ta Nang – Phan Dung trek',
        'region': 'Lâm Đồng',
        'region_en': 'Lâm Đồng',
        'travel_mode': 'hiking',
        'color': '#0F766E',
        'profile': 'foot',
        'expect_main_km': (30, 80),
        'description_vi': ('Cung trekking băng qua các đồi cỏ và rừng thông từ Tà Năng xuống Phan Dũng '
                           '(nay thuộc tỉnh Lâm Đồng). Phần lớn cung đường mất sóng, chỉ có sóng yếu trên '
                           'các đỉnh đồi; nơi xảy ra vụ việc tháng 5/2018.'),
        'description_en': ('Trek across grass hills and pine forest from Ta Nang down to Phan Dung (now Lam Dong '
                           'province). Most of the trail has no signal, only weak coverage on ridge tops; site '
                           'of the May 2018 incident.'),
        'nodes': [
            ('tn-ta-nang', 'Làng Tà Năng (thôn Chơ Ré)', 'Ta Nang village (Cho Re)', 'village', 11.59148, 108.46572),
            ('tn-trailhead', 'Điểm bắt đầu trek Tà Năng', 'Ta Nang trailhead', 'trailhead', 11.579842, 108.475125),
            ('tn-parniane', 'Sườn núi Parniane', 'Parniane hillside', 'viewpoint', 11.55630, 108.49990),
            ('tn-ma-bo', 'Thôn Ma Bó (đường mòn)', 'Ma Bo hamlet (trail)', 'village', 11.582075, 108.514418),
            ('tn-junction', 'Ngã ba đồi cỏ', 'Grass-hill junction', 'junction', 11.55423, 108.525045),
            ('tn-stop2', 'Điểm dừng số 2 (đồi cỏ)', 'Stop 2 viewpoint (grass hills)', 'viewpoint', 11.53484, 108.53237),
            ('tn-camp', 'Điểm cắm trại Phan Dũng', 'Phan Dung camp site', 'poi', 11.51151, 108.56258),
            ('tn-ridge', 'Đỉnh đồi cỏ phía nam', 'Southern grass ridge', 'viewpoint', 11.49160, 108.57730),
            ('tn-forest', 'Bìa rừng Phan Dũng', 'Phan Dung forest edge', 'poi', 11.46393, 108.59380),
            ('tn-stream', 'Điểm vượt suối Phan Dũng', 'Phan Dung stream crossing', 'poi', 11.43201, 108.62837),
            ('tn-phan-dung', 'Làng Phan Dũng', 'Phan Dung village', 'village', 11.428048, 108.638691),
            ('tn-lien-huong', 'Liên Hương (TTYT Tuy Phong)', 'Lien Huong (Tuy Phong medical centre)', 'town', 11.22981, 108.72853),
        ],
        'edges': [
            ('tn-ta-nang', 'tn-trailhead', 'main'),
            ('tn-trailhead', 'tn-parniane', 'main'),
            ('tn-parniane', 'tn-junction', 'main'),
            ('tn-junction', 'tn-stop2', 'main'),
            ('tn-stop2', 'tn-camp', 'main'),
            ('tn-camp', 'tn-ridge', 'main'),
            ('tn-ridge', 'tn-forest', 'main'),
            # OSM has no mapped path for this ~5 km descent (checked with Overpass); geometry is synthesised.
            ('tn-forest', 'tn-stream', 'main', {'synth': True}),
            ('tn-stream', 'tn-phan-dung', 'main'),
            ('tn-trailhead', 'tn-ma-bo', 'alt'),
            ('tn-ma-bo', 'tn-junction', 'alt'),
            ('tn-phan-dung', 'tn-lien-huong', 'connector', {'profile': 'driving'}),
        ],
    },
    {
        'id': 'ha-giang-loop',
        'sort': 3,
        'name': 'Hà Giang Loop',
        'name_en': 'Ha Giang Loop',
        'region': 'Tuyên Quang (khu vực Hà Giang cũ)',
        'region_en': 'Tuyên Quang (former Hà Giang province)',
        'travel_mode': 'motorbike',
        'color': '#7C3AED',
        'profile': 'driving',
        'expect_main_km': (280, 380),
        'description_vi': ('Vòng cung cao nguyên đá: Hà Giang – Quản Bạ – Yên Minh – Đồng Văn – Mã Pí Lèng – '
                           'Mèo Vạc – Du Già. Có nhánh tắt Mèo Vạc – Mậu Duệ – Yên Minh và nhánh lên cột cờ '
                           'Lũng Cú. Từ 07/2025 khu vực thuộc tỉnh Tuyên Quang.'),
        'description_en': ('Karst plateau loop: Ha Giang – Quan Ba – Yen Minh – Dong Van – Ma Pi Leng – Meo Vac – '
                           'Du Gia, with the Meo Vac – Mau Due – Yen Minh shortcut and the Lung Cu flag tower spur. '
                           'Part of Tuyen Quang province since 07/2025.'),
        'nodes': [
            ('hg-ha-giang', 'TP. Hà Giang', 'Ha Giang city', 'town', 22.830311, 104.983451),
            ('hg-bac-sum', 'Dốc Bắc Sum', 'Bac Sum slope', 'pass', 22.98817, 104.93590),
            ('hg-quan-ba-gate', 'Cổng Trời Quản Bạ', 'Quan Ba Heaven Gate', 'pass', 23.04932, 104.99302),
            ('hg-quan-ba', 'Quản Bạ (Tam Sơn)', 'Quan Ba (Tam Son)', 'town', 23.06650, 104.99550),
            ('hg-yen-minh', 'Yên Minh', 'Yen Minh', 'town', 23.123338, 105.148497),
            ('hg-yen-minh-jct', 'Ngã ba ĐT176 (Yên Minh)', 'DT176 junction (Yen Minh)', 'junction', 23.123049, 105.164809),
            ('hg-tham-ma', 'Dốc Thẩm Mã', 'Tham Ma slope', 'pass', 23.16892, 105.19415),
            ('hg-sung-la', 'Thung lũng Sủng Là', 'Sung La valley', 'village', 23.23260, 105.21627),
            ('hg-sa-phin', 'Sà Phìn (lối vào Dinh thự họ Vương)', 'Sa Phin (Vuong mansion turn-off)', 'poi', 23.252786, 105.265891),
            ('hg-lung-cu-jct', 'Ngã ba đường lên Lũng Cú', 'Lung Cu road junction', 'junction', 23.276374, 105.341141),
            ('hg-dong-van', 'Đồng Văn', 'Dong Van', 'town', 23.27814, 105.36200),
            ('hg-ma-pi-leng', 'Đèo Mã Pí Lèng', 'Ma Pi Leng pass', 'pass', 23.24062, 105.41208),
            ('hg-meo-vac', 'Mèo Vạc', 'Meo Vac', 'town', 23.16248, 105.40833),
            ('hg-mau-due', 'Ngã ba Mậu Duệ', 'Mau Due junction', 'junction', 23.066294, 105.234664),
            ('hg-du-gia', 'Du Già', 'Du Gia', 'village', 22.930014, 105.223472),
            ('hg-minh-ngoc', 'Minh Ngọc (QL34)', 'Minh Ngoc (QL34)', 'junction', 22.77690, 105.17920),
            ('hg-ma-le', 'Ma Lé', 'Ma Le', 'village', 23.31009, 105.29889),
            ('hg-lung-cu', 'Cột cờ Lũng Cú', 'Lung Cu flag tower', 'viewpoint', 23.36346, 105.31633),
        ],
        'edges': [
            ('hg-ha-giang', 'hg-bac-sum', 'main'),
            ('hg-bac-sum', 'hg-quan-ba-gate', 'main'),
            ('hg-quan-ba-gate', 'hg-quan-ba', 'main'),
            ('hg-quan-ba', 'hg-yen-minh', 'main'),
            ('hg-yen-minh', 'hg-yen-minh-jct', 'main'),
            ('hg-yen-minh-jct', 'hg-tham-ma', 'main'),
            ('hg-tham-ma', 'hg-sung-la', 'main'),
            ('hg-sung-la', 'hg-sa-phin', 'main'),
            ('hg-sa-phin', 'hg-lung-cu-jct', 'main'),
            ('hg-lung-cu-jct', 'hg-dong-van', 'main'),
            ('hg-dong-van', 'hg-ma-pi-leng', 'main'),
            ('hg-ma-pi-leng', 'hg-meo-vac', 'main'),
            ('hg-meo-vac', 'hg-mau-due', 'main'),
            ('hg-mau-due', 'hg-du-gia', 'main'),
            ('hg-du-gia', 'hg-minh-ngoc', 'main'),
            ('hg-minh-ngoc', 'hg-ha-giang', 'main'),
            ('hg-mau-due', 'hg-yen-minh-jct', 'alt'),
            ('hg-lung-cu-jct', 'hg-ma-le', 'spur'),
            ('hg-ma-le', 'hg-lung-cu', 'spur'),
        ],
    },
]

CARRIERS = [
    {'id': 'viettel', 'name': 'Viettel', 'sort': 1},
    {'id': 'vinaphone', 'name': 'VinaPhone', 'sort': 2},
    {'id': 'mobifone', 'name': 'MobiFone', 'sort': 3},
]
