"""NomadCare seed — demo server-side activity: devices, buddy sessions of OTHER travelers,
their check-in timelines, community submissions, community signal reports, audit trail.

Times are minute offsets relative to ANCHOR (see build_seed.ANCHOR = 2026-09-27 10:00 +07:00).
The builder stores both the absolute ISO time and an `offset_min` map so the local backend can
re-base every timestamp to "now" when it seeds (README §Timestamps). Recipient e-mails use the
reserved example.com domain so no real inbox can ever receive a demo alert.
Positions: ('node', node_id), ('edge', from, to, frac) or ('dz', path, delta_km) — see build_seed.Resolver.
"""

DEVICES = [
    # key, carrier, app_version, created_offset, last_seen_offset
    ('dev-lukas', 'viettel', '2.0.0-demo', -2880, -12),
    ('dev-chloe', 'mobifone', '2.0.0-demo', -1500, -33),
    ('dev-nam', 'viettel', '2.0.0-demo', -4300, -118),
    ('dev-sarah', 'vinaphone', '2.0.0-demo', -2000, -217),
    ('dev-khoa', 'viettel', '2.0.0-demo', -9000, -1255),
    ('dev-community-1', 'vinaphone', '2.0.0-demo', -20000, -300),
    ('dev-community-2', 'mobifone', '2.0.0-demo', -15000, -2900),
]

# Travel paths (node ids in travel order) for ('dz', path, delta_km) anchors: the builder finds the first
# 'lost' run of the session's carrier along the path and places the event delta_km from its start.
KL_WEST = ['kl-da-sar', 'kl-long-lanh', 'kl-deo-top', 'kl-deo-mid']
KL_EAST = ['kl-khanh-vinh', 'kl-cau-ba', 'kl-lien-sang', 'kl-deo-mid', 'kl-deo-top']
HG_DU_GIA = ['hg-mau-due', 'hg-du-gia', 'hg-minh-ngoc']
TN_TRAIL = ['tn-trailhead', 'tn-parniane', 'tn-junction', 'tn-stop2', 'tn-camp']

# Buddy sessions. Events: (kind, offset_min, position, extra) — extra may hold received offset
# ('rx'), queued flag, accuracy, note, meta.
SESSIONS = [
    {
        # active, on time: day 2 of the loop, last check-in 40 min ago, next due in 80 min
        'key': 'bd-lukas', 'device': 'dev-lukas', 'status': 'active',
        'traveler_name': 'Lukas M.', 'recipient_name': 'Anna M.', 'recipient_email': 'anna.m@example.com',
        'recipient_phone': '+84 000 000 002', 'interval_min': 120, 'grace_min': 30,
        'route_id': 'ha-giang-loop', 'travel_mode': 'motorbike', 'share_public_medical': False,
        'public_medical': None,
        'events': [
            ('start', -300, ('node', 'hg-quan-ba'), {'note': 'Bắt đầu ngày 2 của vòng Hà Giang'}),
            ('checkin', -238, ('edge', 'hg-quan-ba', 'hg-yen-minh', 0.35), {}),
            ('location', -175, ('edge', 'hg-quan-ba', 'hg-yen-minh', 0.70), {}),
            ('checkin', -122, ('node', 'hg-yen-minh'), {'note': 'Nghỉ trưa ở Yên Minh'}),
            ('location', -70, ('edge', 'hg-yen-minh-jct', 'hg-tham-ma', 0.6), {}),
            ('checkin', -40, ('node', 'hg-tham-ma'), {}),
            ('location', -12, ('edge', 'hg-tham-ma', 'hg-sung-la', 0.7), {}),
        ],
    },
    {
        # active, due soon (+8 min): warned before the Long Lanh dead zone, last fix just before entering it
        'key': 'bd-chloe', 'device': 'dev-chloe', 'status': 'active',
        'traveler_name': 'Chloé D.', 'recipient_name': 'Julien D.', 'recipient_email': 'julien.d@example.com',
        'recipient_phone': '+84 000 000 003', 'interval_min': 60, 'grace_min': 15,
        'route_id': 'khanh-le', 'travel_mode': 'motorbike', 'share_public_medical': True,
        'public_medical': {'blood_type': 'A+', 'allergies': 'Không', 'conditions': 'Không',
                           'medications': 'Thuốc chống say xe', 'notes': ''},
        'events': [
            ('start', -150, ('node', 'kl-da-lat'), {'note': 'Đà Lạt → Nha Trang qua QL27C'}),
            ('checkin', -112, ('node', 'kl-lac-duong'), {}),
            ('checkin', -52, ('node', 'kl-da-sar'), {}),
            ('pre_deadzone', -37, ('dz', KL_WEST, -2.0), {'label': 'Long Lanh – đèo Khánh Lê'}),
            ('location', -33, ('dz', KL_WEST, -0.3), {}),
        ],
    },
    {
        # overdue (not yet alerted): solo trekker, last fix at the edge of the forest dead zone
        'key': 'bd-nam', 'device': 'dev-nam', 'status': 'overdue',
        'traveler_name': 'Nguyễn Hoàng Nam', 'recipient_name': 'Nguyễn Thu Hà', 'recipient_email': 'thuha.nguyen@example.com',
        'recipient_phone': '+84 000 000 004', 'interval_min': 90, 'grace_min': 30,
        'route_id': 'ta-nang-phan-dung', 'travel_mode': 'hiking', 'share_public_medical': True,
        'public_medical': {'blood_type': 'B+', 'allergies': 'Hải sản', 'conditions': 'Không',
                           'medications': 'Không', 'notes': ''},
        'events': [
            ('start', -270, ('node', 'tn-ta-nang'), {'note': 'Trek 1 ngày, đi một mình'}),
            ('checkin', -232, ('node', 'tn-trailhead'), {}),
            # pressed on the Parniane hillside with a weak signal: queued, delivered 13 min later
            ('checkin', -141, ('node', 'tn-parniane'), {'rx': -128, 'queued': True}),
            ('pre_deadzone', -128, ('dz', TN_TRAIL, -0.8), {'label': 'rừng giữa cung trek'}),
            ('location', -118, ('dz', TN_TRAIL, -0.3), {'accuracy_m': 38}),
            ('overdue', -21, ('dz', TN_TRAIL, -0.3),
             {'server': True, 'note': 'Quá hạn check-in 30 phút (hạn 90 phút + 30 phút ân hạn)'}),
        ],
    },
    {
        # alerted: overdue in the Mậu Duệ – Du Già dead zone, e-mail sent to the recipient
        'key': 'bd-sarah', 'device': 'dev-sarah', 'status': 'alerted',
        'traveler_name': 'Sarah K.', 'recipient_name': 'Tom K.', 'recipient_email': 'tom.k@example.com',
        'recipient_phone': '+84 000 000 005', 'interval_min': 90, 'grace_min': 30,
        'route_id': 'ha-giang-loop', 'travel_mode': 'motorbike', 'share_public_medical': True,
        'public_medical': {'blood_type': 'O−', 'allergies': 'Penicillin', 'conditions': 'Không',
                           'medications': 'Không', 'notes': ''},
        'events': [
            ('start', -400, ('node', 'hg-meo-vac'), {'note': 'Mèo Vạc → Du Già'}),
            ('checkin', -330, ('edge', 'hg-meo-vac', 'hg-mau-due', 0.5), {}),
            ('checkin', -242, ('node', 'hg-mau-due'), {}),
            ('pre_deadzone', -221, ('dz', HG_DU_GIA, -2.0), {'label': 'Mậu Duệ – Du Già'}),
            ('location', -217, ('dz', HG_DU_GIA, -0.3), {}),
            ('overdue', -122, ('dz', HG_DU_GIA, -0.3),
             {'server': True, 'note': 'Quá hạn check-in 30 phút'}),
            ('alert_sent', -121, ('dz', HG_DU_GIA, -0.3),
             {'server': True, 'meta': {'provider': 'resend', 'id': 'demo-9f3c2a71', 'to': 'tom.k@example.com'},
              'note': 'Đã gửi email cảnh báo kèm vị trí cuối và lớp y tế công khai'}),
        ],
    },
    {
        # closed yesterday: Nha Trang → Đà Lạt, checked in again at the pass summit after the dead zone
        'key': 'bd-khoa', 'device': 'dev-khoa', 'status': 'closed',
        'traveler_name': 'Trần Minh Khoa', 'recipient_name': 'Trần Thị Lan', 'recipient_email': 'lan.tran@example.com',
        'recipient_phone': '+84 000 000 006', 'interval_min': 120, 'grace_min': 30,
        'route_id': 'khanh-le', 'travel_mode': 'motorbike', 'share_public_medical': False,
        'public_medical': None,
        'events': [
            ('start', -1590, ('node', 'kl-nha-trang'), {'note': 'Nha Trang → Đà Lạt'}),
            ('checkin', -1520, ('node', 'kl-khanh-vinh'), {}),
            ('pre_deadzone', -1483, ('dz', KL_EAST, -2.0), {'label': 'đèo Khánh Lê'}),
            ('checkin', -1417, ('node', 'kl-deo-top'), {'note': 'Qua đèo an toàn, có sóng lại ở đỉnh đèo'}),
            ('checkin', -1335, ('node', 'kl-da-sar'), {}),
            ('checkin', -1293, ('node', 'kl-lac-duong'), {}),
            ('stop', -1265, ('node', 'kl-da-lat'), {'note': 'Đã tới Đà Lạt'}),
        ],
    },
]

# Pending community submissions (NC_SEED.submissions)
SUBMISSIONS = [
    {'key': 'sub-001', 'device': 'dev-community-1', 'kind': 'new', 'offset': -2160, 'at': ('edge', 'hg-dong-van', 'hg-ma-pi-leng', 0.95),
     'payload': {'name': 'Điểm sơ cứu trạm dừng chân Mã Pí Lèng', 'type': 'tram_y_te',
                 'note': 'Có hộp sơ cứu và người trực bán vé; nên xác minh giờ hoạt động.'}},
    {'key': 'sub-002', 'device': 'dev-community-1', 'kind': 'correction', 'offset': -1450, 'facility': ('ha-giang-loop', 'Trạm Y tế xã Lũng Cú'),
     'payload': {'field': 'open_hours', 'value': '07:00–17:00 (ngoài giờ gọi y sĩ trực)',
                 'note': 'Buổi tối trạm đóng cửa, có số trực dán ngoài cửa.'}},
    {'key': 'sub-003', 'device': 'dev-community-2', 'kind': 'closed', 'offset': -900, 'facility': ('khanh-le', 'Nhà thuốc Thanh Tâm'),
     'payload': {'note': 'Nhà thuốc đóng cửa từ đầu tháng 9, đã chuyển đi nơi khác.'}},
    {'key': 'sub-004', 'device': 'dev-community-2', 'kind': 'signal_report', 'offset': -600, 'at': ('edge', 'kl-long-lanh', 'kl-deo-top', 0.5),
     'payload': {'carrier': 'mobifone', 'level': 'lost',
                 'note': 'Mất sóng hoàn toàn từ khu vực Long Lanh tới gần đỉnh đèo, kể cả gọi khẩn cấp phải chờ.'}},
    {'key': 'sub-005', 'device': 'dev-nam', 'kind': 'new', 'offset': -4200, 'at': ('node', 'tn-ma-bo'),
     'payload': {'name': 'Nhà thuốc bà Hoa (thôn Ma Bó)', 'type': 'nha_thuoc',
                 'note': 'Bán thuốc cơ bản, băng gạc; mở cửa buổi sáng.'}},
    {'key': 'sub-006', 'device': 'dev-community-1', 'kind': 'correction', 'offset': -240, 'facility': ('ta-nang-phan-dung', 'Trạm Y tế Phan Dũng'),
     'payload': {'field': 'phone', 'value': '+84 000 000 077', 'note': 'Trạm đổi số trực đêm.'}},
]

# Community signal reports awaiting review: (route, from, to, frac_list, carrier, device, offset)
COMMUNITY_SAMPLES = [
    ('ha-giang-loop', 'hg-mau-due', 'hg-du-gia', [0.40, 0.46, 0.52, 0.58, 0.64, 0.70], 'mobifone', 'dev-community-2', -2900),
    ('ha-giang-loop', 'hg-du-gia', 'hg-minh-ngoc', [0.15, 0.22, 0.30, 0.38], 'vinaphone', 'dev-community-1', -1600),
    ('khanh-le', 'kl-long-lanh', 'kl-deo-top', [0.20, 0.35, 0.50, 0.65, 0.80], 'vinaphone', 'dev-community-1', -700),
    ('khanh-le', 'kl-deo-top', 'kl-deo-mid', [0.05, 0.10, 0.40], 'viettel', 'dev-chloe', -5800),
    ('ta-nang-phan-dung', 'tn-stop2', 'tn-camp', [0.05, 0.20, 0.50, 0.85], 'viettel', 'dev-nam', -4250),
    ('ta-nang-phan-dung', 'tn-camp', 'tn-ridge', [0.10, 0.80], 'mobifone', 'dev-community-2', -4100),
]

CONTENT_RELEASES = [
    # 1.0.0-demo never reached users: withdrawn from review when 1.1.0-demo replaced it (wave-3 content review).
    {'id': 1, 'version': '1.0.0-demo', 'kind': 'medical', 'status': 'retracted',
     'notes': 'Bản trình diễn đầu — thay bằng 1.1.0-demo trước khi ký duyệt (chưa từng phát hành)',
     'reviewer_round1': 'Nhóm Stormbreakers', 'approver': None, 'approved_at': None, 'offset': -10080},
    {'id': 2, 'version': '1.1.0-demo', 'kind': 'medical', 'status': 'in_review',
     'notes': 'Rà soát nội bộ vòng 1, thêm 7 tình huống sơ cứu; chờ cố vấn ký duyệt vòng 2',
     'reviewer_round1': 'Nhóm Stormbreakers', 'approver': None, 'approved_at': None, 'offset': 0},
]

# Audit trail (actor_label, action, entity, entity_id, details, offset)
AUDIT = [
    ('Nhóm Stormbreakers (seed)', 'import.samples', 'signal_samples', 'khanh-le', {'source': 'team', 'trip': '2026-07-18'}, -100800),
    ('Nhóm Stormbreakers (seed)', 'import.samples', 'signal_samples', 'ta-nang-phan-dung', {'source': 'team', 'trip': '2026-08-01'}, -82000),
    ('Nhóm Stormbreakers (seed)', 'import.samples', 'signal_samples', 'ha-giang-loop', {'source': 'team', 'trip': '2026-08-20'}, -53000),
    ('Nhóm Stormbreakers (seed)', 'model.run', 'signal_segments', 'idw-0.3-demo', {'holdout': 0.2, 'min_run_m': 300}, -20160),
    ('Nhóm Stormbreakers (seed)', 'facility.verify', 'facilities', None, {'count': 'batch', 'method': 'gọi điện xác nhận'}, -14400),
    ('Nhóm Stormbreakers (seed)', 'content.submit_review', 'content_releases', '1.0.0-demo', {'status': 'in_review'}, -10080),
    ('Nhóm Stormbreakers (seed)', 'content.submit_review', 'content_releases', '1.1.0-demo', {'status': 'in_review', 'replaces': '1.0.0-demo'}, -1440),
    ('Nhóm Stormbreakers (seed)', 'pack.publish', 'data_packs', 'all', {'version': 1, 'routes': 3, 'carriers': 3}, -780),
    ('Hệ thống (cron)', 'buddy.overdue', 'buddy_sessions', 'bd-sarah', {'overdue_by_min': 30}, -122),
    ('Hệ thống (cron)', 'buddy.alert_sent', 'buddy_sessions', 'bd-sarah', {'provider': 'resend'}, -121),
    ('Hệ thống (cron)', 'buddy.overdue', 'buddy_sessions', 'bd-nam', {'overdue_by_min': 30}, -21),
    ('Cộng đồng', 'submission.create', 'facility_submissions', 'sub-006', {'kind': 'correction'}, -240),
    ('Cộng đồng', 'submission.create', 'facility_submissions', 'sub-004', {'kind': 'signal_report'}, -600),
]
