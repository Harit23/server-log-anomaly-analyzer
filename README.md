# Server Log Anomaly and Latency Analyzer
**Probability & Statistics Project — Group 17 · JG University, School of Engineering (BTech CSE)**

Parses web-server logs into a database, computes latency percentiles per endpoint, detects abnormal
time windows (latency and error rate), and shows why the **mean is a poor summary of latency**.

**Live website:** https://harit23.github.io/server-log-anomaly-analyzer/ (GitHub Pages, served from `/docs`)

## Headline results (seed 17, 48 h, 172,866 requests, 6 endpoints)
| Finding | Number |
|---|---|
| Mean vs median vs p99 (all traffic) | 115.6 ms / 78.6 ms / 632.2 ms (p99 is 5.5x the mean) |
| Injected incidents detected | 3 of 3, each within one 5-minute window |
| False alerts on the original data / on 8 incident-free days | 0 / 0 |
| Checkout incident: change in mean vs p99 | mean +99%, p99 +384%, median -1% |
| Streaming p99 error (log-bucket sketch / P²) | 0.1% / 6.2% (on mixed, non-stationary traffic) |

## Run it
```bash
pip install -r requirements.txt
python src/generate_logs.py          # data/access.log.gz  (seed 17, reproducible)
python src/parse_to_db.py            # data/logs.db        (SQLite + data-quality log)
python src/streaming.py              # self-test of heap median, P² and sketch
python src/analysis.py               # results.json, figures, website data (~30 s)
```
SQL: `sql/schema.sql` (tables + indexes), `sql/queries.sql` (7 analytical queries incl. window functions).

## Folder map
| Folder | Contents |
|---|---|
| `data/` | `access.log.gz` synthetic log (the database `logs.db` is rebuilt by the parser) |
| `sql/` | schema + analytical queries |
| `src/` | generator, parser, streaming structures, analysis |
| `notebooks/` | walkthrough notebook |
| `reports/` | final report, results.json, figures, presentation |
| `docs/` | the live website |

## Method in one paragraph
Latency per endpoint is modelled as **lognormal** (right-skewed, long tail). Arrivals are a **Poisson process**
with a daily cycle. Three incidents are injected so we know the ground truth. Each endpoint's traffic is cut into
5-minute windows; a window is flagged if the **median of log-latency** is >= 4 standard errors above normal, or if an
**exact one-sided binomial test** on the error count is significant after a Bonferroni correction. A second,
heap-based detector compares per-minute p95 with a rolling 60-minute median.

## Theory vs experiment
1. **Mean hides p99** — four lognormals with the same 100 ms mean have p99 from 192 ms to 1,063 ms; a real incident moves p99 about 4x more than the mean.
2. **Exact vs streaming percentiles** — a 1% log-bucket sketch matches exact p99 within 0.1%; P² (5 numbers of memory) is within 6% on mixed traffic.
3. **False-alarm rate** — theory predicts the normal-tail rate per window; measured on 8 clean days it is at or below theory (see report for why).

## Limitations
Synthetic data (no real NASA log used), latency independent of load, only 2 days, known incident shapes.
AI-tool disclosure: this project was built with assistance from Claude (Anthropic); the group reviewed and understands the work.
