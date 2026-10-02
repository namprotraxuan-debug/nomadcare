"""NomadCare seed — synthetic but physically plausible signal survey + IDW segmentation.

Pipeline (per route, per carrier), mirroring PDF §6.3:
  1. synthetic BTS sites  : towns/villages + roadside sites every ~7 km (carrier-dependent density),
                            none inside documented dead zones.
  2. "survey" samples     : every ~400 m along every edge, 3 phones in parallel (one SIM per carrier).
                            RSRP = log-distance path loss from the best site + terrain/zone penalty
                            + spatially correlated shadowing (Gauss-Markov) + measurement noise.
  3. holdout              : 20 % of each route x carrier kept out of the model.
  4. IDW (k nearest, p=2) : evaluated every 100 m along each edge, 3-level classification,
                            merged into runs (min 300 m), confidence from local sample agreement.
  5. accuracy             : share of holdout samples whose level equals the published segment level.
Levels: likely >= -105 dBm, uncertain -115..-105, lost < -115 or no service (contract §8).
"""
import math
import random

import geo

CARRIERS = ('viettel', 'vinaphone', 'mobifone')
LEVEL_RANK = {'lost': 0, 'uncertain': 1, 'likely': 2}
NO_SERVICE_DBM = -130.0          # value used for 'none' samples inside the interpolation
SAMPLE_STEP_KM = 0.4
EVAL_STEP_KM = 0.1
MIN_RUN_KM = 0.3
IDW_K = 6
IDW_POWER = 2.0
HOLDOUT_SHARE = 0.20

P_REF_1KM = -71.0                # RSRP at 1 km from a typical rural macro site (dBm)
PATH_EXP = 3.3                   # log-distance exponent for hilly terrain

# carrier presence probability for (small village site, roadside site) and power offset (dB)
CARRIER_PROFILE = {
    'north': {'viettel': (0.95, 0.80, 0.0), 'vinaphone': (0.60, 0.50, -3.0), 'mobifone': (0.35, 0.28, -6.0)},
    'south': {'viettel': (0.90, 0.75, 0.0), 'vinaphone': (0.70, 0.60, -2.0), 'mobifone': (0.60, 0.50, -3.0)},
}

# Base clutter loss per route (dB) — forest canopy on the trek is the dominant term there.
BASE_LOSS = {'khanh-le': 4.0, 'ta-nang-phan-dung': 9.0, 'ha-giang-loop': 5.0}

# Documented / modelled zones. Each span = (from_node, to_node, frac_from, frac_to).
# penalty > 0 attenuates, < 0 is a line-of-sight bonus (ridge tops, pass summits).
ZONES = {
    'khanh-le': [
        {'label': 'Thôn Long Lanh – đèo Khánh Lê (điểm lõm sóng đã công bố)', 'no_towers': True, 'ramp_km': 1.2,
         'spans': [('kl-da-sar', 'kl-long-lanh', 0.40, 1.0), ('kl-long-lanh', 'kl-deo-top', 0.0, 1.0),
                   ('kl-deo-top', 'kl-deo-mid', 0.0, 1.0), ('kl-deo-mid', 'kl-lien-sang', 0.0, 0.72)],
         'penalty': {'viettel': 21.0, 'vinaphone': 27.0, 'mobifone': 27.0}},
        {'label': 'Đỉnh đèo — nhìn thẳng xuống thung lũng Khánh Vĩnh', 'ramp_km': 0.8,
         'spans': [('kl-long-lanh', 'kl-deo-top', 0.86, 1.0), ('kl-deo-top', 'kl-deo-mid', 0.0, 0.14)],
         'penalty': {'viettel': -13.0, 'vinaphone': -8.0, 'mobifone': -4.0}},
        {'label': 'Rừng thông Lạc Dương – Đạ Sar', 'ramp_km': 1.0,
         'spans': [('kl-lac-duong', 'kl-da-sar', 0.45, 0.8)],
         'penalty': {'viettel': 4.0, 'vinaphone': 7.0, 'mobifone': 9.0}},
    ],
    'ta-nang-phan-dung': [
        {'label': 'Rừng và thung lũng giữa cung trek (mất sóng)', 'no_towers': True, 'ramp_km': 0.6,
         'spans': [('tn-trailhead', 'tn-parniane', 0.25, 1.0), ('tn-parniane', 'tn-junction', 0.0, 1.0),
                   ('tn-trailhead', 'tn-ma-bo', 0.30, 1.0), ('tn-ma-bo', 'tn-junction', 0.0, 1.0),
                   ('tn-junction', 'tn-stop2', 0.0, 1.0), ('tn-stop2', 'tn-camp', 0.0, 1.0),
                   ('tn-camp', 'tn-ridge', 0.0, 1.0), ('tn-ridge', 'tn-forest', 0.0, 1.0),
                   ('tn-forest', 'tn-stream', 0.0, 1.0), ('tn-stream', 'tn-phan-dung', 0.0, 0.55)],
         'penalty': {'viettel': 17.0, 'vinaphone': 18.0, 'mobifone': 19.0}},
        {'label': 'Đỉnh đồi cỏ — sóng yếu', 'ramp_km': 0.5,
         'spans': [('tn-trailhead', 'tn-parniane', 0.78, 1.0), ('tn-parniane', 'tn-junction', 0.0, 0.25),
                   ('tn-junction', 'tn-stop2', 0.62, 1.0), ('tn-stop2', 'tn-camp', 0.0, 0.30),
                   ('tn-stop2', 'tn-camp', 0.78, 1.0), ('tn-camp', 'tn-ridge', 0.0, 0.35),
                   ('tn-camp', 'tn-ridge', 0.72, 1.0), ('tn-ridge', 'tn-forest', 0.0, 0.22)],
         'penalty': {'viettel': -15.0, 'vinaphone': -11.0, 'mobifone': -8.0}},
    ],
    'ha-giang-loop': [
        {'label': 'Dốc Bắc Sum', 'ramp_km': 1.0,
         'spans': [('hg-ha-giang', 'hg-bac-sum', 0.72, 1.0), ('hg-bac-sum', 'hg-quan-ba-gate', 0.0, 0.35)],
         'penalty': {'viettel': 6.0, 'vinaphone': 10.0, 'mobifone': 13.0}},
        {'label': 'Thung lũng Quản Bạ – Yên Minh', 'ramp_km': 2.0,
         'spans': [('hg-quan-ba', 'hg-yen-minh', 0.30, 0.70)],
         'penalty': {'viettel': 5.0, 'vinaphone': 11.0, 'mobifone': 15.0}},
        {'label': 'Dốc Thẩm Mã', 'ramp_km': 1.0,
         'spans': [('hg-yen-minh-jct', 'hg-tham-ma', 0.55, 1.0), ('hg-tham-ma', 'hg-sung-la', 0.0, 0.30)],
         'penalty': {'viettel': 5.0, 'vinaphone': 10.0, 'mobifone': 14.0}},
        {'label': 'Hẻm Tu Sản – đèo Mã Pí Lèng', 'no_towers': True, 'ramp_km': 1.2,
         'spans': [('hg-dong-van', 'hg-ma-pi-leng', 0.40, 1.0), ('hg-ma-pi-leng', 'hg-meo-vac', 0.0, 0.62)],
         'penalty': {'viettel': 17.0, 'vinaphone': 25.0, 'mobifone': 30.0}},
        {'label': 'Điểm ngắm Mã Pí Lèng', 'ramp_km': 0.5,
         'spans': [('hg-dong-van', 'hg-ma-pi-leng', 0.93, 1.0), ('hg-ma-pi-leng', 'hg-meo-vac', 0.0, 0.06)],
         'penalty': {'viettel': -9.0, 'vinaphone': -5.0, 'mobifone': 0.0}},
        {'label': 'Mèo Vạc – Mậu Duệ', 'ramp_km': 2.0,
         'spans': [('hg-meo-vac', 'hg-mau-due', 0.30, 0.72)],
         'penalty': {'viettel': 7.0, 'vinaphone': 14.0, 'mobifone': 20.0}},
        {'label': 'Cung Mậu Duệ – Du Già – Minh Ngọc', 'no_towers': True, 'ramp_km': 1.5,
         'spans': [('hg-mau-due', 'hg-du-gia', 0.30, 0.93), ('hg-du-gia', 'hg-minh-ngoc', 0.07, 0.62)],
         'penalty': {'viettel': 15.0, 'vinaphone': 24.0, 'mobifone': 30.0}},
        # karst valleys below the flag tower: the road winds within 2–4 km of the sites but has no line of sight
        {'label': 'Đường lên Lũng Cú', 'no_towers': True, 'ramp_km': 1.0,
         'spans': [('hg-ma-le', 'hg-lung-cu', 0.18, 0.84)],
         'penalty': {'viettel': 27.0, 'vinaphone': 30.0, 'mobifone': 32.0}},
    ],
}

# Extra explicit (synthetic) sites: (lat, lng, {carrier: offset_dB}, is_5g, note)
EXTRA_SITES = {
    'khanh-le': [],
    'ta-nang-phan-dung': [
        # hypothetical high site on Hòn Diên serving the lowlands; ridge tops see it at ~10–15 km
        (11.5506, 108.6438, {'viettel': 4.0, 'vinaphone': 1.0}, False, 'BTS giả định Hòn Diên'),
        (11.6026, 108.5252, {'viettel': 2.0, 'mobifone': -2.0}, False, 'BTS giả định núi Ti Sca Do'),
    ],
    'ha-giang-loop': [
        (23.3620, 105.3180, {'viettel': 2.0, 'vinaphone': -2.0}, False, 'BTS biên giới Lũng Cú (giả định)'),
    ],
}

BIG_TOWNS = {'kl-da-lat': 4, 'kl-nha-trang': 4, 'kl-dien-khanh': 2, 'kl-khanh-vinh': 2, 'kl-lac-duong': 2,
             'hg-ha-giang': 4, 'hg-dong-van': 2, 'hg-meo-vac': 2, 'hg-yen-minh': 2, 'hg-quan-ba': 2,
             'tn-lien-huong': 3}
FIVE_G_TOWNS = {'kl-da-lat', 'kl-nha-trang', 'hg-ha-giang'}


def region_of(route_id):
    return 'north' if route_id == 'ha-giang-loop' else 'south'


class RouteSignal:
    """Holds the synthetic radio environment of one route."""

    def __init__(self, route, nodes, edges, rng):
        self.route_id = route['id']
        self.rng = rng
        self.nodes = {n['id']: n for n in nodes}
        self.edges = edges
        self.cum = {e['id']: geo.cumulative_km([tuple(p) for p in e['geometry']]) for e in edges}
        self.edge_by_pair = {(e['from'], e['to']): e for e in edges}
        self.zones = ZONES.get(self.route_id, [])
        self.sites = self._make_sites()

    # ----- zones ---------------------------------------------------------------------------
    def zone_penalty(self, edge, km, carrier):
        """Sum of zone penalties at (edge, km) with cosine ramps at span borders."""
        total = 0.0
        L = edge['length_km'] or 1e-9
        for z in self.zones:
            ramp = z.get('ramp_km', 1.0)
            best = 0.0
            for (a, b, f0, f1) in z['spans']:
                if (a, b) != (edge['from'], edge['to']):
                    continue
                k0, k1 = f0 * L, f1 * L
                # distance inside the span (negative outside); spans touching a node run on into the next edge
                if k0 <= km <= k1:
                    inside = min(km - k0 if f0 > 0 else ramp, k1 - km if f1 < 1 else ramp)
                    w = 1.0 if inside >= ramp else 0.5 - 0.5 * math.cos(math.pi * inside / ramp)
                    best = max(best, w)
            total += best * z['penalty'].get(carrier, 0.0)
        return total

    def in_no_tower_zone(self, edge, km):
        L = edge['length_km'] or 1e-9
        for z in self.zones:
            if not z.get('no_towers'):
                continue
            for (a, b, f0, f1) in z['spans']:
                if (a, b) == (edge['from'], edge['to']) and f0 * L - 1.5 <= km <= f1 * L + 1.5:
                    return True
        return False

    # ----- sites ---------------------------------------------------------------------------
    def _make_sites(self):
        rng = self.rng
        prof = CARRIER_PROFILE[region_of(self.route_id)]
        sites = []

        def add(p, carriers, five_g=False, note=''):
            sites.append({'lat': p[0], 'lng': p[1], 'carriers': carriers, 'five_g': five_g, 'note': note})

        for n in self.nodes.values():
            p = (n['lat'], n['lng'])
            if n['kind'] == 'town':
                for i in range(BIG_TOWNS.get(n['id'], 1)):
                    q = geo.offset_point(p, rng.uniform(-900, 900), rng.uniform(-900, 900))
                    carriers = {c: prof[c][2] + rng.uniform(-1.5, 1.5) for c in CARRIERS
                                if c != 'mobifone' or i == 0 or rng.random() < prof['mobifone'][0]}
                    add(q, carriers, n['id'] in FIVE_G_TOWNS and i < 2, 'town')
            elif n['kind'] in ('village', 'junction', 'poi'):
                if self.route_id == 'ta-nang-phan-dung' and n['id'] not in ('tn-ta-nang', 'tn-phan-dung', 'tn-ma-bo'):
                    continue  # nothing is built in the middle of the trek
                q = geo.offset_point(p, rng.uniform(-500, 500), rng.uniform(-500, 500))
                carriers = {c: prof[c][2] - 2.0 + rng.uniform(-1.5, 1.5) for c in CARRIERS if rng.random() < prof[c][0]}
                if n['id'] == 'tn-phan-dung':
                    carriers = {'viettel': -1.0, 'vinaphone': -6.0}
                if n['id'] == 'tn-ma-bo':
                    carriers = {'viettel': 2.0}  # small Viettel site serving the hamlet (makes the alt branch the better-signal choice)
                if carriers:
                    add(q, carriers, False, 'village')
        # roadside sites on driving edges
        for e in self.edges:
            if e['profile'] != 'driving':
                continue
            line = [tuple(p) for p in e['geometry']]
            cum = self.cum[e['id']]
            km = rng.uniform(2.5, 5.0)
            while km < e['length_km'] - 2.0:
                if not self.in_no_tower_zone(e, km):
                    p = geo.point_at(line, km, cum)
                    q = geo.offset_point(p, rng.uniform(-1200, 1200), rng.uniform(-1200, 1200))
                    carriers = {c: prof[c][2] + rng.uniform(-2, 2) for c in CARRIERS if rng.random() < prof[c][1]}
                    if carriers:
                        add(q, carriers, False, 'road')
                km += rng.uniform(5.5, 8.5)
        for (lat, lng, carriers, five_g, note) in EXTRA_SITES.get(self.route_id, []):
            add((lat, lng), dict(carriers), five_g, note)
        return sites

    def measure(self, edge, km, p, carrier, noise_db):
        """(tech, rsrp_dbm|None) a logger would report at point p (km along edge) given extra noise."""
        rsrp, site = self.best_site(p, carrier)
        rsrp -= BASE_LOSS.get(self.route_id, 5.0) + self.zone_penalty(edge, km, carrier)
        rsrp += noise_db
        tech = tech_of(rsrp, carrier, bool(site and site['five_g']), self.rng)
        val = None if tech == 'none' else int(round(max(-140.0, min(-44.0, rsrp))))
        return tech, val

    def best_site(self, p, carrier):
        best, best_site = -999.0, None
        for s in self.sites:
            off = s['carriers'].get(carrier)
            if off is None:
                continue
            d = max(0.15, geo.haversine_km(p, (s['lat'], s['lng'])))
            v = P_REF_1KM + off - 10.0 * PATH_EXP * math.log10(d)
            if v > best:
                best, best_site = v, s
        return best, best_site


def level_of(rsrp):
    if rsrp is None:
        return 'lost'
    if rsrp >= -105:
        return 'likely'
    if rsrp >= -115:
        return 'uncertain'
    return 'lost'


def tech_of(rsrp, carrier, five_g_site, rng):
    """Radio technology reported by the logger for a given (noisy) RSRP-equivalent value."""
    if rsrp < -125:
        return 'none'
    if five_g_site and rsrp >= -92 and carrier in ('viettel', 'vinaphone'):
        return '5G'
    if rsrp >= -117:
        return '4G'
    if carrier == 'viettel' and rsrp < -121 and rng.random() < 0.5:
        return '2G'
    return '3G'


class GaussMarkov:
    """AR(1) process sampled at arbitrary along-track steps (correlation length L km)."""

    def __init__(self, rng, sigma, corr_km):
        self.rng, self.sigma, self.L = rng, sigma, corr_km
        self.v = rng.gauss(0, sigma)
        self.last_km = None

    def at(self, km):
        if self.last_km is not None:
            rho = math.exp(-abs(km - self.last_km) / self.L)
            self.v = rho * self.v + math.sqrt(1 - rho * rho) * self.rng.gauss(0, self.sigma)
        self.last_km = km
        return self.v


def survey(route, nodes, edges, trip, rng, next_id):
    """Generate team survey samples (3 carriers in parallel) for one route.

    trip: callable(edge, along_km) -> ISO timestamp string (survey timeline).
    Returns (samples, env). Samples carry private keys '_along', '_edge' for later steps.
    """
    env = RouteSignal(route, nodes, edges, rng)
    samples = []
    for e in edges:
        line = [tuple(p) for p in e['geometry']]
        cum = env.cum[e['id']]
        L = e['length_km']
        n = max(1, int(round(L / SAMPLE_STEP_KM)))
        step = L / n
        common = GaussMarkov(rng, 4.0, 1.0)
        own = {c: GaussMarkov(rng, 3.5, 0.8) for c in CARRIERS}
        for i in range(n):
            km = min(L, max(0.0, (i + 0.5) * step + rng.uniform(-0.05, 0.05)))
            p = geo.point_at(line, km, cum)
            ts = trip(e, km)
            shadow_c = common.at(km)
            for c in CARRIERS:
                tech, val = env.measure(e, km, p, c, shadow_c + own[c].at(km) + rng.gauss(0, 2.5))
                q = geo.offset_point(p, rng.gauss(0, 4), rng.gauss(0, 4))  # per-phone GPS noise
                samples.append({
                    'id': next_id(), 'route_id': route['id'], 'edge_id': e['id'], 'carrier': c, 'tech': tech,
                    'rsrp_dbm': val, 'level': level_of(val), 'lat': round(q[0], 6), 'lng': round(q[1], 6),
                    'measured_at': ts, 'source': 'team', 'status': 'approved', 'device_model': DEVICE_MODEL[c],
                    'is_holdout': False, '_along': km,
                })
    # 20 % holdout per carrier (exact share, reproducible)
    for c in CARRIERS:
        mine = [s for s in samples if s['carrier'] == c]
        k = int(round(len(mine) * HOLDOUT_SHARE))
        for s in rng.sample(mine, k):
            s['is_holdout'] = True
    return samples, env


DEVICE_MODEL = {
    'viettel': 'Samsung Galaxy A35 · logger Android · demo',
    'vinaphone': 'Xiaomi Redmi Note 13 · logger Android · demo',
    'mobifone': 'OPPO A79 · logger Android · demo',
}


def _value(s):
    return NO_SERVICE_DBM if s['rsrp_dbm'] is None else float(s['rsrp_dbm'])


def idw(index, p, k=IDW_K, power=IDW_POWER):
    near = index.knearest(p, k)
    if not near:
        return None, 0.0
    num = den = 0.0
    for d, s in near:
        w = 1.0 / max(d, 0.03) ** power
        num += w * _value(s)
        den += w
    return num / den, near[0][0]


def _merge_runs(runs):
    """runs: list of [from_km, to_km, level]; absorb runs shorter than MIN_RUN_KM into a neighbour."""
    runs = [list(r) for r in runs]
    # coalesce equal neighbours first
    def coalesce(rs):
        out = []
        for r in rs:
            if out and out[-1][2] == r[2]:
                out[-1][1] = r[1]
            else:
                out.append(r)
        return out
    runs = coalesce(runs)
    while len(runs) > 1:
        short = [(r[1] - r[0], i) for i, r in enumerate(runs) if r[1] - r[0] < MIN_RUN_KM - 1e-9]
        if not short:
            break
        _, i = min(short)
        r = runs[i]
        left = runs[i - 1] if i > 0 else None
        right = runs[i + 1] if i + 1 < len(runs) else None
        if left is None or right is None:
            target = left if right is None else right
        elif left[2] == right[2]:
            target = left
        else:
            dl = abs(LEVEL_RANK[left[2]] - LEVEL_RANK[r[2]])
            dr = abs(LEVEL_RANK[right[2]] - LEVEL_RANK[r[2]])
            if dl != dr:
                target = left if dl < dr else right
            else:  # tie: stay on the safe side, take the more pessimistic neighbour
                target = left if LEVEL_RANK[left[2]] <= LEVEL_RANK[right[2]] else right
        r[2] = target[2]
        runs = coalesce(runs)
    return runs


def segment_edge(edge, index, edge_samples):
    """3-level segments covering [0, length_km] of one edge for one carrier."""
    L = edge['length_km']
    line = [tuple(p) for p in edge['geometry']]
    cum = geo.cumulative_km(line)
    nb = max(1, int(math.ceil(L / EVAL_STEP_KM - 1e-9)))
    runs = []
    for b in range(nb):
        k0 = b * EVAL_STEP_KM
        k1 = min(L, (b + 1) * EVAL_STEP_KM)
        if k1 <= k0:
            continue
        val, _ = idw(index, geo.point_at(line, (k0 + k1) / 2, cum))
        runs.append([k0, k1, level_of(val) if val is not None else 'uncertain'])
    runs = _merge_runs(runs)
    segs = []
    for seq, (k0, k1, lvl) in enumerate(runs):
        near = [s for s in edge_samples if k0 - 0.2 <= s['_along'] <= k1 + 0.2]
        n = len(near)
        agree = sum(1 for s in near if s['level'] == lvl)
        conf = 0.35 if n == 0 else 0.35 + 0.6 * (agree / n) * (1 - math.exp(-n / 2.5))
        segs.append({'edge_id': edge['id'], 'seq': seq, 'from_km': round(k0, 3), 'to_km': round(k1, 3),
                     'level': lvl, 'confidence': round(min(0.97, conf), 2)})
    segs[0]['from_km'] = 0.0
    segs[-1]['to_km'] = round(L, 3)
    for a, b in zip(segs, segs[1:]):
        b['from_km'] = a['to_km']
    return segs


def level_at(segs, km):
    for s in segs:
        if s['from_km'] - 1e-9 <= km <= s['to_km'] + 1e-9:
            return s['level']
    return segs[-1]['level']


def model_route(route, edges, samples):
    """Segments + accuracy for all carriers of one route. Returns (segments, accuracy_rows)."""
    segments, acc = [], []
    for c in CARRIERS:
        train = [s for s in samples if s['carrier'] == c and not s['is_holdout']
                 and s['source'] == 'team' and s['status'] == 'approved']
        hold = [s for s in samples if s['carrier'] == c and s['is_holdout']]
        index = geo.GridIndex(train, key=lambda s: (s['lat'], s['lng']), cell_deg=0.01)
        by_edge = {}
        for e in edges:
            segs = segment_edge(e, index, [s for s in train if s['edge_id'] == e['id']])
            by_edge[e['id']] = segs
            for s in segs:
                segments.append(dict(s, route_id=route['id'], carrier=c))
        hit = sum(1 for s in hold if level_at(by_edge[s['edge_id']], s['_along']) == s['level'])
        acc.append({'route_id': route['id'], 'carrier': c, 'accuracy': round(hit / len(hold), 3) if hold else None,
                    'holdout_n': len(hold)})
    return segments, acc
