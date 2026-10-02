# tools/seed — NomadCare v2 illustrative dataset

Builds the demo dataset of the three pilot routes (contract §10) and writes:

| Output | Global | Used by |
|---|---|---|
| `assets/js/data/seed-core.js` | `window.NC_SEED` | app + admin: routes, graph, signal segments, accuracy, facilities, services, submissions, content release, pack list (~235 KB) |
| `assets/js/data/seed-admin.js` | `window.NC_SEED_ADMIN` | admin only: raw signal samples, demo devices, buddy sessions, check-in events, audit (~1.3 MB) |
| `supabase/seed.sql` | — | Supabase: the same data plus version-1 data packs (idempotent) |

**All data is illustrative** (`is_demo: true`). Demo phone numbers use the invalid pattern `+84 000 000 0NN`, and buddy recipients use `@example.com`. Route geometry © OpenStreetMap contributors (ODbL), routed with OSRM.

## Usage

```bash
python3 tools/seed/build_seed.py            # build (network only for URLs missing from cache/)
python3 tools/seed/build_seed.py --offline  # build strictly from tools/seed/cache/ (no network at all)
python3 tools/seed/build_seed.py --check    # validate the generated files + print the summary table
```

Requirements: Python ≥ 3.7, standard library only. `node` is optional: `--check` uses it to `require()` both JS files.
The build is **deterministic**: RNG seed `20260927`, fixed build time `2026-09-27T08:00+07:00`, cached HTTP. Running it twice gives byte-identical files.

## Modules

| File | Role |
|---|---|
| `build_seed.py` | Orchestrator: builds everything, emits JS/SQL, runs the validator (`--check`) |
| `defs_routes.py` | The 3 routes as graphs: nodes (id, names vi/en, kind, waypoint) + edges (`main`/`alt`/`spur`/`connector`) |
| `graph.py` | Fetches every edge from OSRM, snaps nodes onto the road/trail, Douglas–Peucker (25 m), sanity checks |
| `signal_model.py` | Synthetic BTS sites, RSRP survey every 400 m, 20 % holdout, IDW segments, held-out accuracy |
| `defs_pois.py` | Medical facilities (~18–24/route) and essential services (~11–15/route) |
| `defs_admin.py` | Devices, buddy sessions of other travelers, check-in timelines, submissions, community samples, audit |
| `geo.py` | Haversine, polyline helpers, simplification, grid k-NN index |
| `netcache.py` | Polite cached HTTP (User-Agent `NomadCare-AISC-seed/1.0`, ≥ 1.1 s between calls) |
| `build_basemap.py` | Offline vector basemap per corridor → `assets/data/basemap/<route_id>.json` (see [Offline vector basemap](#offline-vector-basemap-build_basemappy)) |
| `cache/` | Every HTTP response of `build_seed.py` (`router-*` OSRM driving, `foot-*` routing.openstreetmap.de foot, `nominatim-*`). The Overpass files (`overpass-<route_id>.json` basemap extracts, `overpass-api-*` GET checks) are git-ignored and not shipped (see [The Overpass cache is not shipped](#offline-vector-basemap-build_basemappy)) |

## Route graphs

| Route | Mode | Main line | Network | Nodes | Edges | Alternatives that make A* matter |
|---|---|---|---|---|---|---|
| `khanh-le` | motorbike | 141.9 km | 158.7 km | 12 | 11 | Connector Khánh Vĩnh → PKĐK khu vực Khánh Bình (off-route facility) |
| `ta-nang-phan-dung` | hiking | 32.4 km | 74.2 km | 12 | 12 | Alt trail trailhead → thôn Ma Bó → grass-hill junction; evacuation connector Phan Dũng → Liên Hương |
| `ha-giang-loop` | motorbike | 293.6 km | 327.5 km | 18 | 19 | Full loop (both directions), QL4C shortcut Mèo Vạc → Mậu Duệ → Yên Minh, spur Đồng Văn junction → Ma Lé → Lũng Cú |

- Node ids are `<prefix>-<slug>` (`kl-`, `tn-`, `hg-`); edges `<prefix>-eNN`, geometry ordered from → to as `[lat, lng]`, `length_km` computed from the simplified geometry. `routes[].geometry` is the chained main line.
- Sanity checks (build aborts otherwise): node snapped ≤ 1.5 km from its waypoint, edge length ≤ 4 × straight distance, main length inside `expect_main_km`; `--check` also asserts Hà Giang → Đồng Văn ≈ 132–152 km (actual 138.6) and Đà Lạt → Nha Trang 125–150 km.
- `tn-e08` (bìa rừng → suối Phan Dũng, 5.3 km) is **synthesised**: OSM has no mapped path there (checked with Overpass), so `graph._synth_trail` draws a gentle deterministic descent. The trek main line follows the OSM foot network (32 km, i.e. the usual 2-day itinerary); the often quoted "55 km" includes approach roads.
- Shortest vs signal routing, examples with the published segments: Mèo Vạc → Hà Giang is shortest via Du Già (99 km) but every carrier's signal cost prefers Yên Minh – Quản Bạ (108 km); trailhead → junction on the trek is shortest via Parniane, while Viettel's signal cost prefers the Ma Bó branch.

## Signal model (`model_version = 'idw-0.3-demo'`)

1. **Sites**: synthetic BTS at towns (1–4 per town), villages/junctions, and roadside sites every 5.5–8.5 km on driving edges — never inside documented dead zones. Carrier presence and power offsets differ by region: Viettel densest, MobiFone weakest in the far north.
2. **Survey**: samples every ~400 m of every edge, three phones in parallel (one SIM per carrier), on realistic survey days (Khánh Lê 07/2026, Tà Năng 08/2026, Hà Giang 20/08/2026).
   `RSRP = −71 dBm @1 km − 33·log10(d_km) + carrier offset − clutter − zone penalty + shadowing + noise`. Shadowing is spatially correlated (Gauss–Markov, shared plus per-carrier), noise σ 2.5 dB, GPS jitter ~4 m. Tech `5G/4G/3G/2G/none` is derived from the level; `none` has `rsrp_dbm = null`.
3. **Zones** (penalty dB, per carrier), documented in `signal_model.ZONES`: Long Lanh – đèo Khánh Lê (PDF: thôn Long Lanh, xã Lạc Dương), the forest/valleys of the whole Tà Năng – Phan Dũng trek with weak signal only on ridge tops, and on Hà Giang: Bắc Sum, Thẩm Mã, Tu Sản – Mã Pí Lèng, Mậu Duệ – Du Già – Minh Ngọc, and the approach to Lũng Cú. Pass summits/ridge tops get a line-of-sight bonus.
4. **Levels**: `likely` ≥ −105 dBm, `uncertain` −115…−105, `lost` < −115 or no service (contract §8).
5. **Holdout**: exactly 20 % of each route × carrier (`is_holdout: true`), never used by the model.
6. **Segments**: IDW (k = 6, p = 2) over non-holdout team samples, evaluated every 100 m of each edge, classified, merged into runs; runs < 300 m are absorbed into a neighbour (ties go to the more pessimistic level). Every edge × carrier is covered contiguously from 0 to `length_km`. `confidence = 0.35 + 0.6 · agreement · (1 − e^(−n/2.5))` over the samples within ±200 m.
7. **Accuracy** per route × carrier = share of holdout samples whose level equals the published segment level at their position (0.78–0.96 in this build).

Community reports (`source: 'community'`, `status: 'pending'`, 24 samples) are generated with the same radio environment and wait for admin review; they are not part of the model.

## Facilities and services

- 2025 administrative names: the Hà Giang area is in **tỉnh Tuyên Quang**, Tà Năng/Phan Dũng in **tỉnh Lâm Đồng**, Khánh Vĩnh/Diên Khánh in **tỉnh Khánh Hòa**; addresses use `xã/phường + tỉnh`.
- Public institutions keep their generic official names and, where OSM maps them, their OSM position; pharmacies, private clinics and all services are fictional. Hours, night shift, trauma capability and verifiers are invented.
- Status mix: 50 verified (10 of them **stale**: `verified_at` < 2026-06-29, i.e. > 90 days before 2026-09-27), 11 pending with missing fields (they cannot be verified until complete: DB check `facilities_verified_complete`), 4 rejected with a reason in `notes`.
- Services: `lodging`, `repair`, `fuel`, `rental`; partners have `is_partner: true`. Repair/rental/fuel partners pay **8 %** (`commission_rate 0.08`). Lodging partners are a **distribution channel** (PDF C.2): `commission_rate 0` and the notes say NomadCare pays them 15 % of Premium sales. Medical facilities never carry a partnership.

## Timestamps and `offset_min` (buddy demo)

The demo scenario is anchored at `ANCHOR = 2026-09-27T10:00:00+07:00` (`NC_SEED_ADMIN.anchor_at`).
Rows of `devices`, `buddy_sessions`, `checkin_events`, `audit` (and `NC_SEED.submissions`) store **both** the absolute ISO time and an `offset_min` map `{column: minutes relative to the anchor}`, e.g.
`{"last_checkin_at": -52, "next_due_at": 8}`.

- **Local backend** (`backend-local.js`): when seeding it sets `column = now + offset_min[column]` and drops `offset_min`, so the scenario always looks live.
- **seed.sql**: the same columns are written as `now() + interval 'N minutes'`.
- Other dates (samples `measured_at`, facility `verified_at`, pack `published_at`) stay absolute. Staleness is relative to the real current date, so after 2026-11 more facilities turn stale; rebuild with a later `ANCHOR`/date pools to refresh.

Scenario at the anchor (5 sessions of other travelers): Lukas (Hà Giang, active, next due +80 min), Chloé (Khánh Lê, active, **due in 8 min**, last fix just before the Long Lanh dead zone), Nam (Tà Năng trek, **overdue**, not yet alerted), Sarah (Mậu Duệ – Du Già, **alerted** by e-mail), Khoa (closed yesterday). `pre_deadzone` events are placed with `('dz', path, delta_km)` anchors relative to the first `lost` run of the device's carrier, and their `meta` (`minutes_to_deadzone`, `distance_km`, `deadzone_km`, `basis`) is derived from the published segments. Live (non-queued) events are only ever sent from places where that carrier has signal (validated).

## supabase/seed.sql

- Run **after** the migrations (`supabase start`/`db reset` runs it automatically via `config.toml`; or paste it into the SQL Editor after `setup_all.sql`).
- Idempotent: carriers, routes, nodes, edges, facilities, services, submissions, content releases and devices are upserted by id; team and seeded community samples, segments and accuracy of the three pilot routes are replaced; demo buddy sessions/events and the seed audit rows (`details.seed = true`) are restored relative to `now()`. Real community rows, devices and sessions are never touched. Row audit triggers are switched off for the bulk load (`nc.audit = 'off'`).
- WKT is **lng lat**: `ST_GeogFromText('SRID=4326;POINT(lng lat)')`.
- Finally, a `DO` block publishes **version 1** of every route × carrier pack that does not exist yet, using `app_private.publish_pack()` when the migrations define it, else `build_data_pack()`; it skips with a notice if neither exists. Packs an admin already published are never overwritten; after changing the seed, republish with `select app_private.publish_all_packs('…');` or from the admin dashboard.

## Validator (`--check`)

Checks record keys against the field lists, unique ids, FK integrity (routes, nodes, edges, facilities, devices, sessions), connected graphs, edge endpoints = node positions, `length_km` = geometry length, bbox, ≥ 10 nodes per route, distinct colors, leg sanity; **full contiguous segment coverage** of every edge × carrier (seq 0..n, 0 → length, no gaps, alternating levels); accuracy and pack rows for all 9 combinations; complete verified facilities, phone pattern, 18–24 facilities and 10–15 services per route, 1–2 rejected, stale share ~15 %; sample FK/tech/level consistency, 20 % holdout, ~400 m spacing; buddy statuses, offsets, due times, one session due within 15 min, live events only where the carrier has signal; file sizes (core ≤ 700 KB, admin ≤ 1.5 MB), both JS files loadable by Node; SQL `lng lat` order and balanced quotes. It prints a summary table (km, nodes, edges, facilities v/stale/p/r, services, samples, accuracy and lost-km share per carrier).

## Changing the data

Edit the `defs_*.py` files (or `ZONES`/`EXTRA_SITES` in `signal_model.py`), run the build and `--check`. A new waypoint means one new OSRM request (cached afterwards); keep requests few and spaced (the fetcher enforces ≥ 1.1 s and the project User-Agent). Never edit the generated JS/SQL by hand.

## Offline vector basemap (`build_basemap.py`)

MOD.02 draws a small vector map (roads, rivers and lakes, place names, peaks) under the route when raster tiles
cannot load (offline, or tiles blocked). It is extracted **once**, at build time, from OpenStreetMap through the
Overpass API, one file per pilot corridor. The files are not precached by the service worker; the app downloads one
on demand into Cache Storage `nc-basemap-v1`.

```bash
python3 tools/seed/build_basemap.py               # build all 3 corridors (network only if a cache file is missing)
python3 tools/seed/build_basemap.py --offline     # build strictly from tools/seed/cache/overpass-<route_id>.json (not shipped; see below)
python3 tools/seed/build_basemap.py --route ha-giang-loop   # one corridor (repeatable)
python3 tools/seed/build_basemap.py --check       # validate assets/data/basemap/*.json + print the stats table (exit 1 on any error; needs no cache)
python3 tools/seed/build_basemap.py --refresh --route khanh-le   # re-download one corridor (rarely needed)
```

Requirements: Python ≥ 3.7, standard library only. The route geometry comes from `assets/js/data/seed-core.js`
(all edges of the route: main line, alternatives, spurs and connectors), so run `build_seed.py` first when the
routes change. Rebuilding from the cache is deterministic (byte-identical output). `generated_at` is the date of the
OSM snapshot reported by Overpass (`osm3s.timestamp_osm_base`), not the build date.
`node --test tools/tests` also runs `basemap-data.test.js`, which checks the same format contract.

**Output** (`assets/data/basemap/<route_id>.json`, format contract in the round-2 plan):

```
{ "v": 1, "route_id": "ha-giang-loop", "bbox": [south, west, north, east], "generated_at": "YYYY-MM-DD",
  "source": "OpenStreetMap (Overpass API)", "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
  "roads":  [{"c": "trunk|primary|secondary|tertiary|unclassified|residential|track|path", "n": "QL.4C"|null, "g": [[lat,lng],…]}],
  "water":  [{"c": "river|stream|canal|lake|reservoir", "n": null|"Sông Nho Quế", "a": false|true, "g": [[lat,lng],…]}],
  "places": [{"n": "Đồng Văn", "k": "town|village|hamlet|suburb|locality", "p": [lat,lng]}],
  "peaks":  [{"n": "…"|null, "e": 1500|null, "p": [lat,lng]}] }
```

- `bbox` is the extent of all coordinates in the file. Coordinates have 5 decimals. `a: true` = closed area ring
  (lakes, reservoirs, wide river polygons; inner rings/islands are not kept).
- Array order is draw order: roads go from minor to major classes (major roads end up on top), water areas come
  before water lines, places go town → suburb → village → locality → hamlet, peaks highest first.
- OSM → class mapping: `motorway`/`trunk` (+ `_link`) → `trunk`; `primary`/`secondary`/`tertiary` (+ `_link`) keep
  their class; `unclassified`; `residential` + `living_street` → `residential`; `track`; `path` + `footway` +
  `bridleway` → `path`. `service` roads, `steps` and culverted streams are left out. Places: `city`/`town` → `town`,
  `quarter` → `suburb`. Water areas: `water=river|oxbow` and `waterway=riverbank` → `river`, `reservoir` (or
  `landuse=reservoir`) → `reservoir`, other `natural=water` → `lake` (unnamed ones < 1 ha dropped).
- Names prefer `name:vi`, then `name`. Major roads show their route number (`QL.4C`, `ĐT.176`, `CT.01`) unless the
  ref is a bare number, in which case the street name wins.
- Places need a name. Peaks need a name or an elevation (`ele`); a peak with neither has no label and is dropped.

**Pipeline**

1. One Overpass query per corridor (`[out:json][timeout:180]`, `out geom qt`), restricted to Vietnam
   (`area["ISO3166-1"="VN"]["admin_level"="2"]`, so no features from across the border). Major classes, rivers,
   lakes, places and peaks come from the route-network bbox padded by 8.5 km; minor roads and streams come from
   `around:2300` m of every edge (edge polylines simplified to 100 m). The query envelope is wider than any build
   buffer on purpose, so tightening the buffers never needs a new query.
2. Ways with the same class and name are merged end to end, then clipped to a buffer around the route network. The
   distance to the network is sampled exactly every 250 m and bilinearly interpolated, so buffer edges are accurate
   to about 0.1 km. Water areas are kept when they touch the buffer and are cut to the corridor bbox.
3. Douglas–Peucker simplification (15 m), rounding to 5 decimals, pieces shorter than 80 m dropped.
4. Size budget: each file must stay ≤ 700 000 bytes (raised from 500 000 on 2026-10-02 so the mountain corridors
   keep the full plan buffers). The builder tries the buffer levels below in order and keeps the first one under
   690 000 bytes. Level 0 is the plan default. The first reductions thin the dense street grids of
   towns (1 km cells with more than 6 km of residential streets), where there is mobile signal and raster tiles
   anyway. After that, the minor classes far from the route go.

| Level | trunk…tertiary, rivers, lakes, places, peaks | unclassified | residential (town grid) | track / path | streams |
|---|---|---|---|---|---|
| 0 | 7 km | 7 km | 2 km (2 km) | 2 km | 2 km |
| 1 | 7 km | 7 km | 2 km (0.6 km) | 2 km | 2 km |
| 2 | 7 km | 6 km | 1.5 km (0.5 km) | 2 km | 1.5 km |
| 3 | 7 km | 5 km | 1.2 km (0.4 km) | 1.8 km | 1.2 km |
| 4 | 7 km | 4.5 km | 1 km (0.3 km) | 1.5 km | 1 km |
| 5 | 6.5 km | 4 km | 0.8 km (0.3 km) | 1.2 km | 0.8 km |
| 6–7 | 6 km | 3–2.5 km | 0.6–0.5 km | 1–0.8 km | 0.6–0.5 km (DP 18–20 m) |

Current build (OSM snapshot 2026-09-29). Sizes are exact bytes, measured against the 700 000-byte limit
(`--check` prints the same numbers and the headroom):

| Corridor | Level | Size (bytes) | Headroom | gzip -9 | Roads (km) | Water | Places | Peaks |
|---|---|---|---|---|---|---|---|---|
| `khanh-le` | 1 | 612 767 | 87 233 | 139 377 | 3 585 (2 099 km) | 201 | 51 | 26 |
| `ta-nang-phan-dung` | 0 | 137 370 | 562 630 | 31 015 | 817 (578 km) | 35 | 18 | 33 |
| `ha-giang-loop` | 0 | 673 127 | 26 873 | 165 501 | 2 241 (2 642 km) | 90 | 181 | 15 |

All three corridors now keep the plan buffers (7 km corridor, minor roads, tracks, paths and streams within 2 km);
`khanh-le` only thins the street grids of Nha Trang, Diên Khánh and Đà Lạt to 0.6 km (level 1).

**Devices that downloaded an older file keep it.** The app has no update check for the basemap, and this rebuild
kept `generated_at` at `2026-09-29` (same OSM snapshot), so a phone that downloaded `khanh-le` or `ha-giang-loop`
before 2026-10-02 still shows "Đã tải · 448 KB / 468 KB" with the thinner file. On such a device (for example the
demo phone), open Bản đồ → Gói dữ liệu → *Nền bản đồ offline*, remove the corridor and download it again; it then
shows 598 KB / 657 KB. A fresh browser (the judges) always gets the current file.

Every route edge lies within 50 m of a basemap road, except `tn-e08`, the synthesised trail (OSM has no path there).

**Overpass fair use.** The builder sends exactly one POST per corridor, and only when its cache file is missing
(or with `--refresh`). It uses the User-Agent `NomadCare-seed/2.0 (AISC student project; contact via project
README)`, checks `/api/status` for a free slot first, waits ≥ 5 s between queries, and backs off on
429/502/503/504 (30 → 240 s, about 10 min in total) before it stops with an error. Do not loop it, do not run it
from CI, and do not point the app at Overpass at runtime.

**The Overpass cache is not shipped.** The raw responses (`tools/seed/cache/overpass-*.json`, about 29 MB for the
three corridors) are listed in the root `.gitignore` and were removed from the submission on purpose: the app only
reads the generated `assets/data/basemap/*.json`, and `--check` and `node --test` need nothing else. A rebuild on a
fresh checkout therefore sends the one query per corridor again (3 queries in total, same fair-use rules), writes
the cache, and runs offline (`--offline`) from then on. The new query returns a newer OSM snapshot, so
`generated_at`, the sizes and the chosen level can change: run `--check` and update the table above. The older
`router-*`, `foot-*` and `nominatim-*` files in `cache/` belong to `build_seed.py` and stay.

**Licence: ODbL.** The basemap files are a derivative database of OpenStreetMap and stay under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (`license: "ODbL-1.0"`). Anyone who
redistributes them must keep that licence and the attribution. The app must show **“© OpenStreetMap contributors”**,
linked to <https://www.openstreetmap.org/copyright>, whenever the vector layer is drawn, the same as for OSM raster
tiles. Changes to the data (clipping, simplification, class mapping) are documented in this section, which is our
statement of how the derivative was made.
