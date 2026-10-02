"""NomadCare seed — small geometry toolkit (stdlib only).

All coordinates are (lat, lng) tuples in degrees; distances in kilometres.
Mirrors the semantics of NC.routing (lineLengthKm / pointAt / nearestOnLine) so that
along-edge kilometres computed here match what the browser computes from the pack.
"""
import math

EARTH_R_KM = 6371.0088


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(h)))


def line_length_km(line):
    return sum(haversine_km(line[i], line[i + 1]) for i in range(len(line) - 1))


def cumulative_km(line):
    out = [0.0]
    for i in range(len(line) - 1):
        out.append(out[-1] + haversine_km(line[i], line[i + 1]))
    return out


def point_at(line, km, cum=None):
    """Point at distance km along the polyline (clamped to its ends)."""
    cum = cum or cumulative_km(line)
    if km <= 0:
        return line[0]
    if km >= cum[-1]:
        return line[-1]
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:  # binary search for the containing vertex pair
        mid = (lo + hi) // 2
        if cum[mid] <= km:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    t = 0.0 if seg == 0 else (km - cum[lo]) / seg
    a, b = line[lo], line[hi]
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def bearing_at(line, km, cum=None):
    """Unit vector (dlat, dlng) in local metres of the line direction at km."""
    cum = cum or cumulative_km(line)
    a = point_at(line, max(0.0, km - 0.02), cum)
    b = point_at(line, min(cum[-1], km + 0.02), cum)
    dy = (b[0] - a[0]) * 111.32
    dx = (b[1] - a[1]) * 111.32 * math.cos(math.radians(a[0]))
    n = math.hypot(dx, dy) or 1.0
    return dy / n, dx / n


def offset_point(p, north_m, east_m):
    """Move point p by metres north/east (small-distance approximation)."""
    dlat = north_m / 111320.0
    dlng = east_m / (111320.0 * math.cos(math.radians(p[0])))
    return (p[0] + dlat, p[1] + dlng)


def _to_xy(p, ref):
    return ((p[1] - ref[1]) * 111320.0 * math.cos(math.radians(ref[0])), (p[0] - ref[0]) * 111320.0)


def _perp_dist_m(p, a, b, ref):
    px, py = _to_xy(p, ref)
    ax, ay = _to_xy(a, ref)
    bx, by = _to_xy(b, ref)
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(line, tol_m=30.0):
    """Douglas–Peucker simplification (iterative, keeps first/last point, order preserved)."""
    if len(line) < 3:
        return list(line)
    ref = line[0]
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            d = _perp_dist_m(line[k], line[i], line[j], ref)
            if d > best:
                best, idx = d, k
        if best > tol_m and idx > 0:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(line, keep) if k]


def nearest_on_line(line, p, cum=None):
    """Return (along_km, distance_km, point) of the closest point of the polyline to p."""
    cum = cum or cumulative_km(line)
    best = (0.0, float('inf'), line[0])
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        ax, ay = _to_xy(a, p)
        bx, by = _to_xy(b, p)
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        t = 0.0 if den == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / den))
        q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        d = haversine_km(p, q)
        if d < best[1]:
            best = (cum[i] + (cum[i + 1] - cum[i]) * t, d, q)
    return best


def bbox(points, pad_deg=0.0):
    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    return [round(min(lats) - pad_deg, 5), round(min(lngs) - pad_deg, 5),
            round(max(lats) + pad_deg, 5), round(max(lngs) + pad_deg, 5)]


def rnd(p, nd=5):
    return [round(p[0], nd), round(p[1], nd)]


class GridIndex:
    """Uniform lat/lng bucket grid for fast k-nearest queries over a few thousand points."""

    def __init__(self, items, key, cell_deg=0.02):
        self.cell = cell_deg
        self.key = key
        self.buckets = {}
        for it in items:
            lat, lng = key(it)
            self.buckets.setdefault((int(lat // cell_deg), int(lng // cell_deg)), []).append(it)

    def knearest(self, p, k, max_ring=12):
        ci, cj = int(p[0] // self.cell), int(p[1] // self.cell)
        found = []
        ring = 0
        while ring <= max_ring:
            for i in range(ci - ring, ci + ring + 1):
                for j in range(cj - ring, cj + ring + 1):
                    if ring and abs(i - ci) != ring and abs(j - cj) != ring:
                        continue  # only the outer ring of cells is new
                    for it in self.buckets.get((i, j), ()):
                        found.append((haversine_km(p, self.key(it)), it))
            # a ring r guarantees every point within r*cell (approx) has been seen
            if len(found) >= k and ring >= 1:
                found.sort(key=lambda x: x[0])
                if found[k - 1][0] <= ring * self.cell * 111.32 * math.cos(math.radians(p[0])):
                    return found[:k]
            ring += 1
        found.sort(key=lambda x: x[0])
        return found[:k]
