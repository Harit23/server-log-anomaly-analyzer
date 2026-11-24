"""Generate synthetic web-server logs with injected incidents.

Why synthetic? The handbook allows "synthetic logs with injected incidents".
Because WE inject the incidents, we know the ground truth and can measure how
well our detector finds them. Fixed random seed => fully reproducible.

Latency model: each endpoint has a LOGNORMAL latency distribution (this is what
real latencies look like: right-skewed, with a long tail).
Arrivals: Poisson process whose rate follows a daily (diurnal) cycle.
"""
import gzip, math, random, sys
from datetime import datetime, timedelta, timezone
import numpy as np

SEED = 17                      # group number, fixed for reproducibility
DAYS = 2
START = datetime(2026, 11, 1, 0, 0, 0, tzinfo=timezone.utc)

# endpoint: (traffic weight, lognormal median ms, sigma, base error rate)
ENDPOINTS = {
    "/":               (30, 40, 0.35, 0.002),
    "/api/search":     (25, 120, 0.55, 0.004),
    "/api/products":   (20, 90, 0.45, 0.003),
    "/api/login":      (10, 150, 0.40, 0.010),
    "/api/checkout":   (8, 300, 0.60, 0.006),
    "/static/app.js":  (7, 15, 0.30, 0.001),
}

# Injected incidents (ground truth): (name, start_hour_from_START, minutes, endpoint or None=all,
#                                      latency multiplier, extra error rate)
INCIDENTS = [
    ("checkout-db-slowdown", 10.0, 25, "/api/checkout", 6.0, 0.02),
    ("global-cache-failure", 30.0, 15, None,            3.0, 0.03),
    ("search-error-burst",   38.5, 20, "/api/search",   1.3, 0.25),
]

def rate_per_sec(t_hours):
    """Requests/second: smooth daily cycle, peak mid-afternoon."""
    return 1.0 + 0.6 * math.sin((t_hours % 24 - 9) / 24 * 2 * math.pi)

def incident_at(t_min, path):
    for name, h, dur, ep, mult, err in INCIDENTS:
        s = h * 60
        if s <= t_min < s + dur and (ep is None or ep == path):
            return mult, err
    return 1.0, 0.0

def main(out="data/access.log.gz", seed=SEED, incidents=True):
    global INCIDENTS
    seed = int(seed); incidents = str(incidents).lower() not in ("0", "false", "no")
    if not incidents: INCIDENTS = []
    rng = random.Random(seed); nrng = np.random.default_rng(seed)
    paths = list(ENDPOINTS); weights = [ENDPOINTS[p][0] for p in paths]
    t = 0.0; end = DAYS * 24 * 3600; n = 0
    with gzip.open(out, "wt") as f:
        while t < end:
            t += rng.expovariate(rate_per_sec(t / 3600))     # exponential gaps = Poisson arrivals
            if t >= end: break
            path = rng.choices(paths, weights)[0]
            _, med, sigma, base_err = ENDPOINTS[path]
            mult, extra_err = incident_at(t / 60, path)
            lat = nrng.lognormal(math.log(med * mult), sigma)
            err = rng.random() < base_err + extra_err
            status = rng.choice([500, 502, 503]) if err else (404 if rng.random() < 0.01 else 200)
            ts = (START + timedelta(seconds=t)).strftime("%d/%b/%Y:%H:%M:%S +0000")
            ip = f"10.{rng.randint(0,255)}.{rng.randint(0,255)}.{rng.randint(1,254)}"
            size = int(nrng.lognormal(7.5, 0.8))
            f.write(f'{ip} - - [{ts}] "GET {path} HTTP/1.1" {status} {size} {lat:.1f}\n')
            n += 1
    print(f"wrote {n} log lines to {out}")

if __name__ == "__main__":
    main(*sys.argv[1:])
