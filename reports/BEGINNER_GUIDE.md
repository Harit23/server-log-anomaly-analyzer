# Group 17 — Beginner's Guide (read this before the viva)

Nobody in the group needs prior knowledge. Read top to bottom; each idea is 2-3 lines.

## 1. The story in one minute
A website answers thousands of requests. Each request takes some time (latency, in milliseconds).
Engineers want to know: *how fast is the site, and when did something break?*
We (1) created realistic log files, (2) put them into a database, (3) calculated percentiles,
(4) built a detector that raises an alert when things go wrong, and (5) checked our detector against
incidents we hid in the data ourselves.

## 2. Words you must know
- **Latency**: time to answer one request (ms).
- **Mean**: add all, divide by count. Pulled up by a few very slow requests.
- **Median / p50**: the middle value. Half of requests are faster.
- **p95 / p99**: 95% / 99% of requests are faster than this. p99 = "the slow 1%". Users feel the tail.
- **Skewed (right-skewed)**: most values small, a few huge. Latency is always like this.
- **Lognormal**: if you take log of the values, you get a bell curve (normal). Good model for latency.
- **Exponential**: the model for *waiting times between random arrivals*. Our request gaps use it.
- **Poisson process**: random arrivals at an average rate; gaps between them are exponential.
- **z-score**: how many standard errors a value is above normal. z >= 4 is very unusual.
- **Hypothesis test / p-value**: "if nothing were wrong, how likely is data this extreme?" Tiny p = something changed.
- **Bonferroni**: if you run 3,000 tests, tighten the cut-off so luck doesn't fool you.
- **Confidence interval**: a range likely to contain the true value.
- **False alarm**: alert when nothing is wrong. **Power / recall**: share of real incidents caught.

## 3. Why the mean is a poor summary (the core idea)
In our data: mean 115.6 ms, median 78.6 ms, p99 632 ms. 34% of requests are slower than the mean, and the slowest
1% take over 5x the mean. During the checkout incident the *median did not move* (-1%), the mean rose 99%, and
p99 rose 384%. One number cannot describe a skewed distribution; report percentiles.

## 4. What each file does
- `src/generate_logs.py` makes the log (Poisson arrivals, lognormal latency, 3 hidden incidents). Seed 17 => same data every run.
- `src/parse_to_db.py` reads the log into SQLite tables and records data-quality issues.
- `sql/queries.sql` percentiles with window functions, rolling averages, worst minutes, histogram.
- `src/streaming.py` the DSA part: heap-based sliding median, P² estimator, log-bucket sketch.
- `src/analysis.py` all statistics, detectors, tests, figures.
- `docs/` the website; `reports/` report, figures, slides.

## 5. Likely viva questions (with short answers)
1. *Why synthetic data?* Handbook allows it; we know the true incidents so we can measure detection and false alarms.
2. *Why lognormal?* Q-Q plot of log-latency is a straight line; AIC is far lower than exponential (by thousands).
3. *Why median of log-latency, not mean?* Robust to outliers; its standard error is about 1.2533 sigma / sqrt(n).
4. *Why Mann-Whitney, not a t-test?* Latency is skewed; rank tests do not assume normality. Welch on log-latency is our cross-check.
5. *What does p = 0.05 mean?* Not "5% chance we are wrong"; it is the chance of data this extreme if there were no change.
6. *Why is measured false-alarm rate below theory?* Windows are small and we estimate sigma robustly; the normal approximation is conservative in the tail. Be honest about this.
7. *Why did the rolling-p95 detector miss the error burst?* That incident barely slowed requests (1.3x); only the error-rate test sees it. Two signals are better than one.
8. *Limitations?* Synthetic data, latency independent of load, 2 days, known incident shapes.

## 6. Split of work for 5 people (suggested)
1 data + SQL · 2 percentiles + distributions · 3 detector + hypothesis tests · 4 streaming structures + theory-vs-experiment · 5 report + slides + website demo.
Each person should be able to explain their section and run `python src/analysis.py`.
