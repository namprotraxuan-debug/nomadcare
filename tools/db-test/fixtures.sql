-- =============================================================================
-- fixtures.sql — tiny stand-in dataset for tools/db-test/run.sh, used ONLY when
-- supabase/seed.sql does not exist yet. Coordinates are rough; all rows demo.
-- Deliberately includes: an edge stored in reverse (to→from) to test pack
-- orientation, an edge without segments, a stale verified facility, an
-- untagged facility inside the corridor, pending/rejected rows.
-- =============================================================================
set search_path = public, extensions;
set nc.audit = 'off';

insert into carriers (id, name, sort) values
  ('viettel', 'Viettel', 1), ('vinaphone', 'VinaPhone', 2), ('mobifone', 'MobiFone', 3)
on conflict (id) do nothing;

insert into routes (id, name, name_en, region, travel_mode, color, description_vi, description_en, geom, sort) values
  ('khanh-le', 'Đèo Khánh Lê (QL27C)', 'Khanh Le Pass (QL27C)', 'Lâm Đồng – Khánh Hoà', 'motorbike', '#0E9384',
   'Đà Lạt ↔ Nha Trang', 'Da Lat ↔ Nha Trang',
   'SRID=4326;LINESTRING(108.44 11.94, 108.60 12.10, 108.90 12.25)', 1),
  ('ha-giang-loop', 'Hà Giang Loop', 'Ha Giang Loop', 'Tuyên Quang', 'motorbike', '#FF6B2C',
   'Vòng cung Hà Giang', 'The Ha Giang loop', null, 2)
on conflict (id) do nothing;

insert into route_nodes (id, route_id, name, name_en, kind, geom) values
  ('kl-dalat',  'khanh-le', 'Đà Lạt',   'Da Lat',   'town', 'SRID=4326;POINT(108.44 11.94)'),
  ('kl-pass',   'khanh-le', 'Đỉnh đèo', 'Pass top', 'pass', 'SRID=4326;POINT(108.60 12.10)'),
  ('kl-nt',     'khanh-le', 'Nha Trang','Nha Trang','town', 'SRID=4326;POINT(108.90 12.25)'),
  ('hg-city',   'ha-giang-loop', 'TP Hà Giang', 'Ha Giang City', 'town', 'SRID=4326;POINT(104.98 22.82)'),
  ('hg-yenminh','ha-giang-loop', 'Yên Minh',    'Yen Minh',      'town', 'SRID=4326;POINT(105.14 23.12)'),
  ('hg-meovac', 'ha-giang-loop', 'Mèo Vạc',     'Meo Vac',       'town', 'SRID=4326;POINT(105.41 23.16)')
on conflict (id) do nothing;

-- kl-e2 geometry is intentionally stored end→start.
insert into route_edges (id, route_id, from_node, to_node, is_connector, geom) values
  ('kl-e1', 'khanh-le', 'kl-dalat', 'kl-pass', false, 'SRID=4326;LINESTRING(108.44 11.94, 108.52 12.02, 108.60 12.10)'),
  ('kl-e2', 'khanh-le', 'kl-pass',  'kl-nt',   false, 'SRID=4326;LINESTRING(108.90 12.25, 108.75 12.18, 108.60 12.10)'),
  ('hg-e1', 'ha-giang-loop', 'hg-city',    'hg-yenminh', false, 'SRID=4326;LINESTRING(104.98 22.82, 105.06 22.97, 105.14 23.12)'),
  ('hg-e2', 'ha-giang-loop', 'hg-yenminh', 'hg-meovac',  false, 'SRID=4326;LINESTRING(105.14 23.12, 105.28 23.15, 105.41 23.16)'),
  ('hg-e3', 'ha-giang-loop', 'hg-meovac',  'hg-city',    false, 'SRID=4326;LINESTRING(105.41 23.16, 105.20 22.95, 104.98 22.82)')
on conflict (id) do nothing;

-- segments (viettel full coverage; hg-e3 has none for vinaphone → synthesized)
insert into signal_segments (route_id, edge_id, carrier, seq, from_km, to_km, level, confidence, model_version)
select e.route_id, e.id, c.id, s.seq,
       round(e.length_km * s.a, 3), round(e.length_km * s.b, 3), s.level, 0.8, 'fixture-0.1'
from route_edges e
cross join carriers c
cross join (values (0, 0.0, 0.4, 'likely'), (1, 0.4, 0.7, 'lost'), (2, 0.7, 1.0, 'uncertain')) as s(seq, a, b, level)
where not (e.id = 'hg-e3' and c.id = 'vinaphone');

insert into route_accuracy (route_id, carrier, accuracy, holdout_n, model_version)
select r.id, c.id, 0.82, 40, 'fixture-0.1' from routes r cross join carriers c
on conflict do nothing;

insert into facilities (id, route_id, name, type, address, geom, phone, open_hours, night_shift, trauma_capable,
                        verified_by, verified_at, status, source, is_demo) values
  ('fx-f1', 'khanh-le', 'Trạm y tế xã Lạc Dương', 'tram_y_te', 'Lạc Dương', 'SRID=4326;POINT(108.45 11.99)',
   '+84 000 000 001', '7:00–17:00', false, true, 'Chị Lan', current_date - 10, 'verified', 'team', true),
  ('fx-f2', 'khanh-le', 'Bệnh viện Đa khoa Khánh Vĩnh', 'benh_vien', 'Khánh Vĩnh', 'SRID=4326;POINT(108.75 12.19)',
   '+84 000 000 002', '24/7', true, true, 'Anh Minh', current_date - 120, 'verified', 'team', true),
  ('fx-f3', 'khanh-le', 'Nhà thuốc chưa xác thực', 'nha_thuoc', null, 'SRID=4326;POINT(108.61 12.11)',
   null, null, null, null, null, null, 'pending', 'community', true),
  ('fx-f4', 'khanh-le', 'Phòng khám đã đóng', 'phong_kham', 'Diên Khánh', 'SRID=4326;POINT(108.85 12.24)',
   '+84 000 000 004', '8:00–16:00', false, false, 'Chị Hoa', current_date - 30, 'rejected', 'team', true),
  ('fx-f5', null, 'Trạm y tế không gắn tuyến', 'tram_y_te', 'Gần đèo', 'SRID=4326;POINT(108.62 12.12)',
   '+84 000 000 005', '7:00–17:00', false, false, 'Anh Tú', current_date - 5, 'verified', 'team', true),
  ('fx-f6', 'ha-giang-loop', 'Trung tâm y tế Yên Minh', 'benh_vien', 'Yên Minh', 'SRID=4326;POINT(105.14 23.11)',
   '+84 000 000 006', '24/7', true, true, 'Chị Mai', current_date - 20, 'verified', 'team', true)
on conflict (id) do nothing;

insert into services (id, route_id, name, type, geom, phone, open_hours, is_partner, status) values
  ('fx-s1', 'khanh-le', 'Homestay Đèo Mây', 'lodging', 'SRID=4326;POINT(108.58 12.08)', '+84 000 000 011', '24/7', true, 'active'),
  ('fx-s2', 'khanh-le', 'Sửa xe Tư', 'repair', 'SRID=4326;POINT(108.70 12.16)', '+84 000 000 012', '7:00–19:00', false, 'inactive'),
  ('fx-s3', 'ha-giang-loop', 'Cây xăng Yên Minh', 'fuel', 'SRID=4326;POINT(105.13 23.12)', '+84 000 000 013', '6:00–22:00', false, 'active')
on conflict (id) do nothing;

insert into facility_submissions (id, kind, facility_id, payload, lat, lng, status) values
  ('fx-sub1', 'new', null, '{"name":"Trạm y tế xã mới","type":"tram_y_te","note":"Có bác sĩ trực"}', 12.05, 108.55, 'pending'),
  ('fx-sub2', 'closed', 'fx-f1', '{"note":"Đóng cửa sửa chữa"}', null, null, 'pending')
on conflict (id) do nothing;

insert into content_releases (version, kind, status, notes, reviewer_round1) values
  ('1.0.0-demo', 'medical', 'in_review', 'Bản nội dung sơ cứu demo', 'Nhóm Stormbreakers')
on conflict (version) do nothing;

insert into signal_samples (route_id, edge_id, carrier, tech, rsrp_dbm, geom, source, status)
values ('khanh-le', 'kl-e1', 'viettel', '4G', -98, 'SRID=4326;POINT(108.50 12.00)', 'team', 'approved'),
       ('khanh-le', 'kl-e2', 'mobifone', 'none', null, 'SRID=4326;POINT(108.70 12.16)', 'team', 'approved');

reset nc.audit;
