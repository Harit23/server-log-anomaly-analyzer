"""Project 17 - Server Log Anomaly and Latency Analyzer: full statistical analysis.

Run:  python src/analysis.py        (needs data/logs.db; see README)
Writes: reports/results.json, docs/data/results.json (website), reports/figures/*.png

Structure follows the handbook's report template:
  1 describe -> 2 fit distributions -> 3 detect anomalies -> 4 test hypotheses
  -> 5 theory-vs-experiment -> 6 stretch goal (false-alarm rate)
"""
import gzip, json, math, os, sqlite3, subprocess, sys, tempfile
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(__file__))
from streaming import SlidingWindowMedian, P2Quantile, LogBucketSketch
import generate_logs as G

RNG = np.random.default_rng(17)
FIG = "reports/figures"; os.makedirs(FIG, exist_ok=True)
os.makedirs("docs/data", exist_ok=True); os.makedirs("docs/img", exist_ok=True)
START = pd.Timestamp(G.START)

# ---------------------------------------------------------------- load
def load(db="data/logs.db"):
    con = sqlite3.connect(db)
    df = pd.read_sql("""SELECT r.ts, e.path, r.status, r.latency_ms, r.is_error
                        FROM requests r JOIN endpoints e USING(endpoint_id) ORDER BY r.ts""", con)
    df["t"] = pd.to_datetime(df["ts"]); df["min"] = ((df["t"] - START).dt.total_seconds() // 60).astype(int)
    df["win"] = df["min"] // 5
    df["loglat"] = np.log(df["latency_ms"])
    return df

def pct(x, ps=(50, 95, 99)): return {f"p{p}": float(np.percentile(x, p)) for p in ps}

# ---------------------------------------------------------------- 1. descriptive
def describe(df):
    out = {}
    for path, g in list(df.groupby("path")) + [("ALL", df)]:
        x = g["latency_ms"].values
        out[path] = dict(n=int(len(x)), mean=float(x.mean()), median=float(np.median(x)), std=float(x.std(ddof=1)),
                         skew=float(stats.skew(x)), **pct(x), p999=float(np.percentile(x, 99.9)),
                         error_rate=float(g["is_error"].mean()),
                         pct_slower_than_mean=float((x > x.mean()).mean()),
                         p99_over_mean=float(np.percentile(x, 99) / x.mean()))
    return out

# ---------------------------------------------------------------- 2. distribution fit (lognormal vs exponential)
def fit_distributions(df, flagged):
    """Fit on 'normal' windows only (windows our detector did NOT flag)."""
    keep = df[~df.set_index(["path", "win"]).index.isin(flagged)]
    res = {}
    for path, g in keep.groupby("path"):
        x = g["latency_ms"].values; lx = np.log(x)
        mu, sig = lx.mean(), lx.std(ddof=0)                       # lognormal MLE
        ll_ln = float(np.sum(stats.lognorm.logpdf(x, s=sig, scale=math.exp(mu))))
        lam = 1 / x.mean(); ll_ex = float(np.sum(stats.expon.logpdf(x, scale=1 / lam)))   # exponential MLE
        ks_ln = stats.kstest(x, "lognorm", args=(sig, 0, math.exp(mu))).statistic
        ks_ex = stats.kstest(x, "expon", args=(0, 1 / lam)).statistic
        th = {f"p{p}": float(math.exp(mu + stats.norm.ppf(p / 100) * sig)) for p in (50, 95, 99)}
        res[path] = dict(n=int(len(x)), mu=float(mu), sigma=float(sig),
                         loglik_lognormal=ll_ln, loglik_exponential=ll_ex,
                         aic_lognormal=2 * 2 - 2 * ll_ln, aic_exponential=2 * 1 - 2 * ll_ex,
                         ks_lognormal=float(ks_ln), ks_exponential=float(ks_ex),
                         empirical=pct(x), theoretical=th,
                         p99_rel_error=float((th["p99"] - np.percentile(x, 99)) / np.percentile(x, 99)))
    return res

# ---------------------------------------------------------------- 3. anomaly detection
MIN_N = 10
def window_table(df):
    g = df.groupby(["path", "win"])
    w = g.agg(n=("latency_ms", "size"), med_log=("loglat", "median"), errs=("is_error", "sum"),
              p95=("latency_ms", lambda s: np.percentile(s, 95)), med=("latency_ms", "median")).reset_index()
    return w[w["n"] >= MIN_N].copy()

def baselines(df):
    b = {}
    for p, g in df.groupby("path"):
        lx = g["loglat"].values; med = np.median(lx)
        b[p] = dict(mu=float(med), sigma=float(1.4826 * np.median(np.abs(lx - med))), err=float(g["is_error"].mean()))
    return b

def score_windows(w, base):
    """z-score for latency (median of log-latency; sd of a sample median ~ 1.2533*sigma/sqrt(n))
       and exact one-sided binomial p-value for errors."""
    mu = w["path"].map(lambda p: base[p]["mu"]); sg = w["path"].map(lambda p: base[p]["sigma"])
    w["z"] = (w["med_log"] - mu) / (1.2533 * sg / np.sqrt(w["n"]))
    p0 = w["path"].map(lambda p: base[p]["err"])
    w["err_p"] = stats.binom.sf(w["errs"] - 1, w["n"], p0)
    return w

Z_THRESH = 4.0          # one-sided p = 3.2e-5 per window
ALPHA_FAMILY = 0.01     # Bonferroni across all windows tested

def flag(w, z=Z_THRESH, alpha_family=ALPHA_FAMILY):
    a = alpha_family / len(w)
    w["lat_flag"] = w["z"] >= z; w["err_flag"] = w["err_p"] < a; w["flag"] = w["lat_flag"] | w["err_flag"]
    return w

def two_pass_baseline(df):
    """Estimate the normal error-rate again after removing windows flagged in pass 1."""
    base = baselines(df); w = flag(score_windows(window_table(df), base))
    bad = set(map(tuple, w.loc[w.flag, ["path", "win"]].values))
    clean = df[~df.set_index(["path", "win"]).index.isin(bad)]
    base2 = baselines(clean)
    for p in base: base[p]["err"] = base2[p]["err"]
    return base

def merge_alerts(w):
    """Merge consecutive flagged windows (same endpoint) into incidents."""
    alerts = []
    for path, g in w[w.flag].sort_values("win").groupby("path"):
        cur = None
        for _, r in g.iterrows():
            if cur and r["win"] - cur["end_win"] <= 1:
                cur["end_win"] = int(r["win"]); cur["max_z"] = max(cur["max_z"], float(r["z"]))
                cur["max_err"] = max(cur["max_err"], float(r["errs"] / r["n"]))
            else:
                if cur: alerts.append(cur)
                cur = dict(path=path, start_win=int(r["win"]), end_win=int(r["win"]), max_z=float(r["z"]),
                           max_err=float(r["errs"] / r["n"]), kind=[])
            k = "latency" if r["lat_flag"] else "errors"
            if k not in cur["kind"]: cur["kind"].append(k)
        if cur: alerts.append(cur)
    for a in alerts:
        a["start_min"] = a["start_win"] * 5; a["end_min"] = a["end_win"] * 5 + 5
    return alerts

def evaluate(alerts):
    """Compare alerts with the injected ground truth."""
    truth, detected = [], 0
    for name, h, dur, ep, mult, err in G.INCIDENTS:
        s, e = h * 60, h * 60 + dur
        hits = [a for a in alerts if a["start_min"] < e and a["end_min"] > s and (ep is None or a["path"] == ep)]
        eps = {a["path"] for a in hits}
        ok = len(eps) >= (3 if ep is None else 1)
        detected += ok
        first = min((a["start_min"] for a in hits), default=None)
        truth.append(dict(name=name, start_min=s, end_min=e, endpoint=ep or "ALL", detected=bool(ok),
                          endpoints_flagged=sorted(eps), delay_min=(None if first is None else max(0, first + 5 - s))))
    def is_true(a):
        return any(a["start_min"] < h * 60 + dur and a["end_min"] > h * 60 and (ep is None or ep == a["path"])
                   for _, h, dur, ep, _, _ in G.INCIDENTS)
    false_alerts = [a for a in alerts if not is_true(a)]
    return truth, detected, false_alerts

# ---------------------------------------------------------------- streaming detector (heap-based, rolling median)
def minute_series(df):
    g = df.groupby("min")["latency_ms"]
    m = pd.DataFrame({"n": g.size(), "mean": g.mean(), "p50": g.median(),
                      "p95": g.quantile(.95), "p99": g.quantile(.99)}).reindex(range(2880))
    err = df.groupby("min")["is_error"].mean().reindex(range(2880))
    m["err"] = err; return m.ffill().fillna(0)

def rolling_alert(p95, window=60, ratio=2.0, run=3):
    """Alert when per-minute p95 > ratio x rolling-median(p95 of the last `window` minutes) for `run` minutes in a row."""
    sw = SlidingWindowMedian(window); flags = []; roll = []; streak = 0; alerts = []
    for i, v in enumerate(p95):
        base = sw.median() if i >= window else None
        hot = base is not None and v > ratio * base
        streak = streak + 1 if hot else 0
        flags.append(streak >= run); roll.append(base)
        if not hot: sw.add(v)          # do not let incident minutes pollute the baseline
    return np.array(flags), roll

def runs(flags):
    out, s = [], None
    for i, f in enumerate(list(flags) + [False]):
        if f and s is None: s = i
        if not f and s is not None: out.append((s, i)); s = None
    return out

# ---------------------------------------------------------------- clean-data (no incidents) for false alarm measurement
def clean_run(seed, base):
    with tempfile.TemporaryDirectory() as d:
        log = os.path.join(d, "clean.log.gz"); dbp = os.path.join(d, "clean.db")
        G.INCIDENTS_BACKUP = list(G.INCIDENTS)
        import importlib; G_inc = list(G.INCIDENTS)
        G.main(log, seed, "false")
        G.INCIDENTS = G_inc                    # restore
        import parse_to_db; parse_to_db.main(log, dbp, "sql/schema.sql")
        return load(dbp)

# ---------------------------------------------------------------- 4. hypothesis tests
def boot_ci(x, f, B=1000):
    idx = RNG.integers(0, len(x), (B, len(x))); vals = np.array([f(x[i]) for i in idx])
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]

def incident_tests(df):
    out = {}
    # (a) checkout latency: baseline 09:00-10:00 vs incident 10:00-10:25 (day 1)
    c = df[df.path == "/api/checkout"]
    base = c[(c["min"] >= 540) & (c["min"] < 600)]["latency_ms"].values
    inc = c[(c["min"] >= 600) & (c["min"] < 625)]["latency_ms"].values
    u = stats.mannwhitneyu(inc, base, alternative="greater")
    t = stats.ttest_ind(np.log(inc), np.log(base), equal_var=False, alternative="greater")
    boots = []
    for _ in range(2000):
        boots.append(np.median(RNG.choice(inc, len(inc))) / np.median(RNG.choice(base, len(base))))
    out["checkout_latency"] = dict(n_base=len(base), n_incident=len(inc),
        median_base=float(np.median(base)), median_incident=float(np.median(inc)),
        median_ratio=float(np.median(inc) / np.median(base)), median_ratio_ci95=[float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
        mannwhitney_U=float(u.statistic), mannwhitney_p=float(u.pvalue),
        prob_incident_slower=float(u.statistic / (len(inc) * len(base))),   # common-language effect size
        welch_t_on_log=float(t.statistic), welch_p=float(t.pvalue),
        why="Latency is right-skewed, so we use Mann-Whitney (rank-based); Welch on log-latency is a cross-check.")
    # (b) search error rate: baseline 07:00-09:30 of day 2 vs incident
    s = df[df.path == "/api/search"]
    b = s[(s["min"] >= 1440 + 0) & (s["min"] < 2250)]; i = s[(s["min"] >= 2310) & (s["min"] < 2330)]
    k1, n1, k2, n2 = int(i.is_error.sum()), len(i), int(b.is_error.sum()), len(b)
    p1, p2 = k1 / n1, k2 / n2; pp = (k1 + k2) / (n1 + n2)
    z = (p1 - p2) / math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)); pval = float(stats.norm.sf(z))
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    out["search_error_rate"] = dict(n_base=n2, n_incident=n1, rate_base=p2, rate_incident=p1, diff=p1 - p2,
        diff_ci95=[p1 - p2 - 1.96 * se, p1 - p2 + 1.96 * se], z=float(z), p_value=pval,
        method="Two-proportion z-test (one-sided), Wald CI for the difference")
    # (c) bootstrap CI on a p99
    allbase = c[(c["min"] < 600)]["latency_ms"].values
    out["p99_ci_checkout_baseline"] = dict(n=len(allbase), p99=float(np.percentile(allbase, 99)), ci95=boot_ci(allbase, lambda a: np.percentile(a, 99), 500))
    return out

# ---------------------------------------------------------------- 5. theory vs experiment
def mean_hides_p99(df):
    r = {}
    # (A) pure theory: lognormals with the SAME mean but different spread
    rows = []
    for sigma in (0.3, 0.6, 1.0, 1.5):
        mu = math.log(100) - sigma ** 2 / 2          # chosen so mean = 100 ms
        rows.append(dict(sigma=sigma, mean=100.0, median=math.exp(mu), p95=math.exp(mu + 1.645 * sigma),
                         p99=math.exp(mu + 2.326 * sigma)))
    r["same_mean_table"] = rows
    # (B) real data: ALL traffic, baseline vs checkout incident
    a = df[(df["min"] >= 540) & (df["min"] < 600)]["latency_ms"].values
    b = df[(df["min"] >= 600) & (df["min"] < 625)]["latency_ms"].values
    r["incident_all_traffic"] = dict(
        mean_base=float(a.mean()), mean_inc=float(b.mean()), mean_change_pct=float(100 * (b.mean() / a.mean() - 1)),
        p99_base=float(np.percentile(a, 99)), p99_inc=float(np.percentile(b, 99)), p99_change_pct=float(100 * (np.percentile(b, 99) / np.percentile(a, 99) - 1)),
        median_base=float(np.median(a)), median_inc=float(np.median(b)), median_change_pct=float(100 * (np.median(b) / np.median(a) - 1)))
    # (C) small-slice tail incident: only 1% of requests become 20x slower
    x = df["latency_ms"].values.copy(); x2 = x.copy(); idx = RNG.choice(len(x), len(x) // 100, replace=False); x2[idx] *= 20
    r["one_percent_tail"] = dict(mean_before=float(x.mean()), mean_after=float(x2.mean()), mean_change_pct=float(100 * (x2.mean() / x.mean() - 1)),
        median_before=float(np.median(x)), median_after=float(np.median(x2)),
        p99_before=float(np.percentile(x, 99)), p99_after=float(np.percentile(x2, 99)), p99_change_pct=float(100 * (np.percentile(x2, 99) / np.percentile(x, 99) - 1)))
    return r

def exact_vs_streaming(df):
    res = {}
    for path, g in list(df.groupby("path")) + [("ALL", df)]:
        x = g["latency_ms"].values; row = {}
        for p in (0.5, 0.95, 0.99):
            p2 = P2Quantile(p); sk = LogBucketSketch(0.01)
            for v in x: p2.add(v); sk.add(v)
            ex = float(np.percentile(x, p * 100))
            row[f"p{int(p*100)}"] = dict(exact=ex, p2=float(p2.value()), sketch=float(sk.quantile(p)),
                                         p2_err_pct=float(100 * (p2.value() - ex) / ex), sketch_err_pct=float(100 * (sk.quantile(p) - ex) / ex))
        row["sketch_buckets"] = len(sk.b); row["n"] = len(x)
        res[path] = row
    return res

def sql_vs_numpy(db="data/logs.db"):
    """Check the SQL (nearest-rank) percentile agrees with numpy's."""
    con = sqlite3.connect(db)
    q = open("sql/queries.sql").read().split(";")[1]
    return {r[0]: dict(p50=r[1], p95=r[2], p99=r[3]) for r in con.execute(q)}

def false_alarm_sweep(train_base, clean_dfs, df):
    """Stretch goal. Same detector, calibrated on the original data, applied to incident-free logs."""
    zs = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]; rows = []
    cw = []
    for c in clean_dfs:
        cw.append(score_windows(window_table(c), train_base))
    cwall = pd.concat(cw); days = 2 * len(clean_dfs)
    wd = score_windows(window_table(df), train_base)
    inc_mask = pd.Series(False, index=wd.index)
    for _, h, dur, ep, _, _ in G.INCIDENTS:
        s, e = h * 60, h * 60 + dur
        inside = (wd["win"] * 5 >= s) & (wd["win"] * 5 + 5 <= e)
        inc_mask |= inside & ((wd["path"] == ep) if ep else True)
    for z in zs:
        meas = float((cwall["z"] >= z).mean()); th = float(stats.norm.sf(z))
        rows.append(dict(z=z, theory_rate=th, measured_rate=meas, measured_count=int((cwall["z"] >= z).sum()),
                         windows_tested=int(len(cwall)), expected_count=th * len(cwall),
                         false_alarms_per_day=float((cwall["z"] >= z).sum() / days),
                         power=float((wd.loc[inc_mask, "z"] >= z).mean())))
    # error-rule calibration
    a_rows = []
    for alpha in (0.05, 0.01, 0.001):
        a_rows.append(dict(alpha=alpha, measured_rate=float((cwall["err_p"] < alpha).mean()), windows=int(len(cwall))))
    return rows, a_rows, int(len(cwall)), days

# ---------------------------------------------------------------- figures
def figures(df, desc, fits, ms, alerts, truth_runs, sweep, stream, mh):
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 140})
    BLUE, RED, GREY, GREEN = "#2563eb", "#dc2626", "#6b7280", "#16a34a"
    def save(name): plt.tight_layout(); plt.savefig(f"{FIG}/{name}.png"); plt.savefig(f"docs/img/{name}.png"); plt.close()
    # 1 skew
    x = df["latency_ms"].values; fig, ax = plt.subplots(1, 2, figsize=(10, 3.6))
    ax[0].hist(x[x < 800], bins=80, color=BLUE, alpha=.8)
    for v, c, l in [(x.mean(), RED, "mean"), (np.median(x), GREEN, "median"), (np.percentile(x, 99), "#7c3aed", "p99")]:
        ax[0].axvline(v, color=c, ls="--"); ax[0].text(v + 5, ax[0].get_ylim()[1] * .9, f"{l} {v:.0f}", color=c, fontsize=8)
    ax[0].set_title("Latency is right-skewed"); ax[0].set_xlabel("latency (ms)"); ax[0].set_ylabel("requests")
    ax[1].hist(np.log(x), bins=80, color=BLUE, alpha=.8); ax[1].set_title("log(latency) looks like a bell curve"); ax[1].set_xlabel("log latency")
    save("fig1_skew")
    # 2 percentiles per endpoint
    eps = [k for k in desc if k != "ALL"]; w = .26; xs = np.arange(len(eps)); fig, ax = plt.subplots(figsize=(9, 3.8))
    for i, (k, c) in enumerate([("p50", GREEN), ("p95", BLUE), ("p99", RED)]):
        ax.bar(xs + (i - 1) * w, [desc[e][k] for e in eps], w, label=k, color=c)
    ax.plot(xs, [desc[e]["mean"] for e in eps], "k_", ms=22, mew=2, label="mean")
    ax.set_xticks(xs); ax.set_xticklabels(eps, rotation=15); ax.set_ylabel("ms"); ax.legend(); ax.set_title("Percentiles per endpoint")
    save("fig2_percentiles")
    # 3 timeline
    fig, ax = plt.subplots(2, 1, figsize=(10, 5.2), sharex=True); hrs = ms.index / 60
    ax[0].plot(hrs, ms["p95"], color=BLUE, lw=.7, label="p95"); ax[0].plot(hrs, ms["mean"], color=GREY, lw=.7, label="mean")
    ax[1].plot(hrs, ms["err"] * 100, color=RED, lw=.7)
    for _, h, dur, ep, _, _ in G.INCIDENTS:
        for a in ax: a.axvspan(h, h + dur / 60, color="#fde68a", alpha=.6)
    ax[0].set_ylabel("ms (per minute)"); ax[0].legend(loc="upper right"); ax[0].set_title("All traffic over 48 h, injected incidents shaded")
    ax[1].set_ylabel("error rate %"); ax[1].set_xlabel("hours since start")
    save("fig3_timeline")
    # 4 mean hides p99
    fig, ax = plt.subplots(1, 2, figsize=(10, 3.6)); t = mh["same_mean_table"]
    xs = np.arange(len(t)); ax[0].bar(xs - .2, [r["median"] for r in t], .4, color=GREEN, label="median"); ax[0].bar(xs + .2, [r["p99"] for r in t], .4, color=RED, label="p99")
    ax[0].axhline(100, color="k", ls="--"); ax[0].text(-.4, 108, "mean = 100 ms for ALL four", fontsize=8)
    ax[0].set_xticks(xs); ax[0].set_xticklabels([f"σ={r['sigma']}" for r in t]); ax[0].set_ylabel("ms"); ax[0].legend(); ax[0].set_title("Same mean, very different p99 (theory)")
    r = mh["incident_all_traffic"]; labs = ["median", "mean", "p99"]; ch = [r["median_change_pct"], r["mean_change_pct"], r["p99_change_pct"]]
    ax[1].bar(labs, ch, color=[GREEN, GREY, RED]); ax[1].set_ylabel("% change during checkout incident"); ax[1].set_title("Real incident: which statistic notices?")
    for i, v in enumerate(ch): ax[1].text(i, v + 5, f"+{v:.0f}%", ha="center")
    save("fig4_mean_vs_p99")
    # 5 false alarm
    fig, ax = plt.subplots(figsize=(6, 3.8)); zs = [r["z"] for r in sweep]
    ax.semilogy(zs, [r["theory_rate"] for r in sweep], "o-", color=BLUE, label="theory (normal tail)")
    ax.semilogy(zs, [max(r["measured_rate"], 1e-6) for r in sweep], "s--", color=RED, label="measured on clean logs")
    ax.set_xlabel("z threshold"); ax.set_ylabel("false-alarm rate per window"); ax.legend(); ax.set_title("False alarms: theory vs measured")
    save("fig5_false_alarms")
    # 6 streaming error
    fig, ax = plt.subplots(figsize=(8, 3.6)); labs = list(stream)
    for i, (k, c) in enumerate([("p2", BLUE), ("sketch", GREEN)]):
        ax.bar(np.arange(len(labs)) + (i - .5) * .35, [abs(stream[e]["p99"][f"{k}_err_pct"]) for e in labs], .35, color=c, label={"p2": "P² (5 numbers)", "sketch": "log-bucket sketch (1%)"}[k])
    ax.set_xticks(range(len(labs))); ax.set_xticklabels(labs, rotation=15); ax.set_ylabel("|error| in p99 (%)"); ax.legend(); ax.set_title("Streaming estimate vs exact p99")
    save("fig6_streaming")
    # 7 QQ for checkout
    g = df[(df.path == "/api/checkout") & (df["min"] < 540)]["loglat"].values
    q = stats.probplot(g, dist="norm"); fig, ax = plt.subplots(figsize=(4.8, 4))
    ax.plot(q[0][0], q[0][1], ".", ms=2, color=BLUE); ax.plot(q[0][0], q[0][0] * q[1][0] + q[1][1], color=RED)
    ax.set_title("Q-Q plot: log(latency) of /api/checkout"); ax.set_xlabel("theoretical normal quantiles"); ax.set_ylabel("sample log-latency")
    save("fig7_qq")

# ---------------------------------------------------------------- main
def main():
    df = load(); print("loaded", len(df))
    base = two_pass_baseline(df)
    w = flag(score_windows(window_table(df), base)); alerts = merge_alerts(w)
    truth, detected, false_alerts = evaluate(alerts)
    flagged = set(map(tuple, w.loc[w.flag, ["path", "win"]].values))
    desc = describe(df); fits = fit_distributions(df, flagged)
    ms = minute_series(df)
    sflags, roll = rolling_alert(ms["p95"].values); sruns = runs(sflags)
    s_hits = [any(s < h * 60 + dur and e > h * 60 for s, e in sruns) for _, h, dur, ep, _, _ in G.INCIDENTS]
    s_false = [(s, e) for s, e in sruns if not any(s < h * 60 + dur and e > h * 60 for _, h, dur, ep, _, _ in G.INCIDENTS)]
    tests = incident_tests(df); mh = mean_hides_p99(df); stream = exact_vs_streaming(df)
    print("generating clean (incident-free) logs for false-alarm measurement ...")
    clean = [clean_run(s, base) for s in (101, 102, 103, 104)]
    sweep, a_rows, nwin, days = false_alarm_sweep(base, clean, df)
    # streaming detector on clean data
    s_clean = sum(len(runs(rolling_alert(minute_series(c)["p95"].values)[0])) for c in clean)
    # main rule false alarms on clean data
    main_fa = 0
    for c in clean:
        wc = flag(score_windows(window_table(c), base), alpha_family=ALPHA_FAMILY); main_fa += len(merge_alerts(wc))
    results = dict(
        meta=dict(requests=len(df), days=2, endpoints=len(desc) - 1, seed=G.SEED, z_threshold=Z_THRESH, alpha_family=ALPHA_FAMILY,
                  window_minutes=5, min_requests_per_window=MIN_N),
        describe=desc, fits=fits, baselines=base,
        detection=dict(truth=truth, detected=detected, total=len(truth), alerts=alerts, false_alerts=false_alerts,
                       streaming=dict(window=60, ratio=2.0, run=3, hits=s_hits, false_runs_original=len(s_false), false_runs_clean=int(s_clean), clean_days=days),
                       main_rule_false_alerts_on_clean=main_fa, clean_days=days, clean_windows=nwin),
        tests=tests, theory_vs_experiment=dict(mean_hides_p99=mh, exact_vs_streaming=stream, sql_vs_numpy=sql_vs_numpy(),
                                               false_alarm_sweep=sweep, error_rule_calibration=a_rows),
        data_quality=[dict(issue=r[0], rows=r[1], action=r[2]) for r in sqlite3.connect("data/logs.db").execute("SELECT * FROM dq_log")],
    )
    # website series
    results["series"] = dict(
        minute=dict(mean=ms["mean"].round(1).tolist(), p50=ms["p50"].round(1).tolist(), p95=ms["p95"].round(1).tolist(), p99=ms["p99"].round(1).tolist(),
                    err=(ms["err"] * 100).round(2).tolist(), n=ms["n"].astype(int).tolist(), roll_p95=[None if r is None else round(r, 1) for r in roll]),
        windows=[dict(path=r.path, win=int(r.win), n=int(r.n), p50=round(float(r.med), 1), p95=round(float(r.p95), 1), z=round(float(r.z), 2),
                      err=round(float(r.errs / r.n * 100), 2), flag=bool(r.flag)) for r in w.itertuples()],
        hist=dict(edges=list(range(0, 1000, 25)), counts=np.histogram(df["latency_ms"], bins=list(range(0, 1001, 25)))[0].tolist()),
        incidents=[dict(name=n, start_min=h * 60, end_min=h * 60 + d, endpoint=ep or "ALL") for n, h, d, ep, _, _ in G.INCIDENTS])
    for p in ("reports/results.json", "docs/data/results.json"):
        json.dump(results, open(p, "w"), default=float, separators=(",", ":") if "docs" in p else (",", ": "), indent=None if "docs" in p else 1)
    figures(df, desc, fits, ms, alerts, sruns, sweep, stream, mh)
    # ---- console summary
    print(f"\nDetected {detected}/{len(truth)} injected incidents; false alerts on original data: {len(false_alerts)}; on {days} clean days: {main_fa}")
    for t in truth: print("  ", t["name"], "detected" if t["detected"] else "MISSED", "delay(min)=", t["delay_min"], t["endpoints_flagged"])
    print("streaming rule hits:", s_hits, "false runs original:", len(s_false), "clean:", s_clean)
    print("sweep:"); [print("  ", {k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()}) for r in sweep]
    print("incident all-traffic:", mh["incident_all_traffic"]); print("one-percent tail:", mh["one_percent_tail"])
    print("tests:", json.dumps(tests, default=float)[:900])

if __name__ == "__main__":
    main()
