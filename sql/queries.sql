-- Q1. Per-endpoint volume, mean, error rate  (aggregation + join)
SELECT e.path, COUNT(*) AS n, ROUND(AVG(r.latency_ms),1) AS mean_ms,
       ROUND(100.0*SUM(r.is_error)/COUNT(*),2) AS error_pct
FROM requests r JOIN endpoints e USING(endpoint_id)
GROUP BY e.path ORDER BY n DESC;

-- Q2. Exact percentiles p50/p95/p99 per endpoint (window functions: ROW_NUMBER + COUNT OVER)
WITH ranked AS (
  SELECT endpoint_id, latency_ms,
         ROW_NUMBER() OVER (PARTITION BY endpoint_id ORDER BY latency_ms) AS rn,
         COUNT(*)     OVER (PARTITION BY endpoint_id)                     AS n
  FROM requests)
SELECT e.path,
  MIN(CASE WHEN rn >= 0.50*n THEN latency_ms END) AS p50,
  MIN(CASE WHEN rn >= 0.95*n THEN latency_ms END) AS p95,
  MIN(CASE WHEN rn >= 0.99*n THEN latency_ms END) AS p99
FROM ranked JOIN endpoints e USING(endpoint_id) GROUP BY e.path;

-- Q3. Per-minute mean latency and error rate (time-bucketed aggregation)
SELECT minute, COUNT(*) AS n, ROUND(AVG(latency_ms),1) AS mean_ms,
       ROUND(100.0*SUM(is_error)/COUNT(*),2) AS error_pct
FROM requests GROUP BY minute ORDER BY minute;

-- Q4. Rolling 15-minute average latency (window function with frame)
WITH m AS (SELECT minute, AVG(latency_ms) AS avg_ms FROM requests GROUP BY minute)
SELECT minute, ROUND(AVG(avg_ms) OVER (ORDER BY minute ROWS BETWEEN 14 PRECEDING AND CURRENT ROW),1) AS roll15_ms
FROM m;

-- Q5. Worst 10 minutes by error rate (min 20 requests so tiny samples don't mislead)
SELECT minute, COUNT(*) AS n, ROUND(100.0*SUM(is_error)/COUNT(*),1) AS error_pct
FROM requests GROUP BY minute HAVING n >= 20 ORDER BY error_pct DESC LIMIT 10;

-- Q6. Latency distribution histogram, 50ms buckets (shows the right-skew)
SELECT CAST(latency_ms/50 AS INT)*50 AS bucket_ms, COUNT(*) AS n
FROM requests WHERE latency_ms < 1000 GROUP BY bucket_ms ORDER BY bucket_ms;

-- Q7. Busiest hours, and change vs the previous hour (LAG window function)
WITH h AS (SELECT substr(minute,1,13) AS hr, COUNT(*) AS n FROM requests GROUP BY hr)
SELECT hr, n, n - LAG(n) OVER (ORDER BY hr) AS change_vs_prev_hour FROM h ORDER BY n DESC LIMIT 10;
