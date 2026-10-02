"""NomadCare seed — build route graphs (nodes/edges) from cached OSRM geometry.

build_routes(offline) -> list of route dicts with snapped nodes, simplified edge geometry
(ordered from -> to), length_km and the main line. Raises on insane legs.
"""
import math

import geo
from defs_routes import ROUTES
from netcache import osrm_route

SIMPLIFY_TOL_M = 25.0
MAX_DETOUR_RATIO = 4.0      # edge length / straight distance; above that the router took a detour
MAX_SNAP_M = 1500.0         # waypoint snapping distance considered sane


def _synth_trail(a, b, seed_phase=0.7):
    """Deterministic, gently meandering descent between a and b (used only where OSM has a gap)."""
    n = 120
    dlat, dlng = b[0] - a[0], b[1] - a[1]
    # perpendicular unit (in degrees, roughly isotropic at this latitude)
    L = math.hypot(dlat, dlng) or 1.0
    plat, plng = -dlng / L, dlat / L
    pts = []
    for i in range(n + 1):
        t = i / n
        off = 0.0042 * math.sin(math.pi * t) + 0.0009 * math.sin(5 * math.pi * t + seed_phase) * math.sin(math.pi * t)
        pts.append((a[0] + dlat * t + plat * off, a[1] + dlng * t + plng * off))
    return pts


def _fetch_edge(route, e_from, e_to, opts, nodes_req, offline):
    profile = opts.get('profile', route['profile'])
    a = nodes_req[e_from]
    b = nodes_req[e_to]
    if opts.get('synth'):
        return _synth_trail(a, b), (a, 0.0), (b, 0.0), 'synth'
    pts = [a] + list(opts.get('via', [])) + [b]
    res = osrm_route(pts, profile=profile, offline=offline)
    if res.get('code') != 'Ok' or not res.get('routes'):
        raise RuntimeError('OSRM failed for %s -> %s: %s' % (e_from, e_to, res.get('message')))
    r = res['routes'][0]
    line = [(c[1], c[0]) for c in r['geometry']['coordinates']]
    wps = res['waypoints']
    wa = ((wps[0]['location'][1], wps[0]['location'][0]), wps[0]['distance'])
    wb = ((wps[-1]['location'][1], wps[-1]['location'][0]), wps[-1]['distance'])
    return line, wa, wb, profile


def build_routes(offline=False, log=print):
    out = []
    for rdef in ROUTES:
        nodes_req = {n[0]: (n[4], n[5]) for n in rdef['nodes']}
        raw = []
        snapped = {}
        for e in rdef['edges']:
            e_from, e_to, role = e[0], e[1], e[2]
            opts = e[3] if len(e) > 3 else {}
            line, wa, wb, profile = _fetch_edge(rdef, e_from, e_to, opts, nodes_req, offline)
            for nid, (pt, dist) in ((e_from, wa), (e_to, wb)):
                if dist > MAX_SNAP_M:
                    raise RuntimeError('node %s snapped %.0f m away from its waypoint' % (nid, dist))
                snapped.setdefault(nid, pt)
            raw.append((e_from, e_to, role, opts, line, profile))
        # --- nodes: snapped road/trail position (first edge wins; later edges are glued to it)
        nodes = []
        for nid, name, name_en, kind, lat, lng in rdef['nodes']:
            p = snapped.get(nid, (lat, lng))
            nodes.append({'id': nid, 'route_id': rdef['id'], 'name': name, 'name_en': name_en,
                          'kind': kind, 'lat': round(p[0], 6), 'lng': round(p[1], 6)})
        npos = {n['id']: (n['lat'], n['lng']) for n in nodes}
        prefix = {'khanh-le': 'kl', 'ta-nang-phan-dung': 'tn', 'ha-giang-loop': 'hg'}[rdef['id']]
        edges = []
        for i, (e_from, e_to, role, opts, line, profile) in enumerate(raw):
            line = [npos[e_from]] + line[1:-1] + [npos[e_to]]
            gap_a = geo.haversine_km(line[0], line[1]) if len(line) > 1 else 0
            simp = geo.simplify(line, SIMPLIFY_TOL_M)
            geom = [tuple(geo.rnd(p)) for p in simp]
            length = geo.line_length_km(geom)
            straight = geo.haversine_km(npos[e_from], npos[e_to])
            ratio = length / straight if straight > 0.05 else 1.0
            if ratio > MAX_DETOUR_RATIO:
                raise RuntimeError('edge %s->%s looks like a detour: %.1f km vs %.1f km straight'
                                   % (e_from, e_to, length, straight))
            edges.append({'id': '%s-e%02d' % (prefix, i + 1), 'route_id': rdef['id'], 'from': e_from, 'to': e_to,
                          'length_km': round(length, 3), 'is_connector': role == 'connector',
                          'role': role, 'profile': profile, 'synth': bool(opts.get('synth')),
                          'raw_points': len(line), 'geometry': [list(p) for p in geom],
                          '_glue_km': gap_a})
        # --- main line: chain the main edges in order
        mains = [e for e in edges if e['role'] == 'main']
        for a, b in zip(mains, mains[1:]):
            if a['to'] != b['from']:
                raise RuntimeError('main edges of %s do not chain: %s then %s' % (rdef['id'], a['id'], b['id']))
        main_line = []
        for e in mains:
            pts = e['geometry'] if not main_line else e['geometry'][1:]
            main_line.extend(pts)
        main_km = sum(e['length_km'] for e in mains)
        lo, hi = rdef['expect_main_km']
        if not lo <= main_km <= hi:
            raise RuntimeError('%s main length %.1f km outside expected %s' % (rdef['id'], main_km, rdef['expect_main_km']))
        all_pts = [tuple(p) for e in edges for p in e['geometry']]
        route = {k: rdef[k] for k in ('id', 'name', 'name_en', 'region', 'region_en', 'travel_mode', 'color', 'sort',
                                      'description_vi', 'description_en')}
        route.update({'length_km': round(main_km, 1), 'bbox': geo.bbox(all_pts, 0.01), 'is_active': True,
                      'geometry': main_line})
        out.append({'route': route, 'nodes': nodes, 'edges': edges})
        log('  %-18s main %.1f km, network %.1f km, %d nodes, %d edges' % (
            rdef['id'], main_km, sum(e['length_km'] for e in edges), len(nodes), len(edges)))
        for e in edges:
            log('     %s %-16s -> %-16s %-9s %7.2f km  (%d -> %d pts)%s' % (
                e['id'], e['from'], e['to'], e['role'], e['length_km'], e['raw_points'], len(e['geometry']),
                ' SYNTH' if e['synth'] else ''))
    return out
