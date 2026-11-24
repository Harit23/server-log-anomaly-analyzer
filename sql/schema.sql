-- ER overview:  endpoints (1) ---- (many) requests
--               requests (1 minute bucket) ---- minute_stats (derived)
CREATE TABLE IF NOT EXISTS endpoints (
    endpoint_id INTEGER PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS requests (
    request_id  INTEGER PRIMARY KEY,
    ts          TEXT    NOT NULL,          -- ISO8601 UTC
    minute      TEXT    NOT NULL,          -- ts truncated to the minute
    ip          TEXT    NOT NULL,
    endpoint_id INTEGER NOT NULL REFERENCES endpoints(endpoint_id),
    status      INTEGER NOT NULL,
    bytes       INTEGER,
    latency_ms  REAL    NOT NULL CHECK (latency_ms >= 0),
    is_error    INTEGER NOT NULL           -- 1 if status >= 500
);
CREATE INDEX IF NOT EXISTS idx_req_minute   ON requests(minute);
CREATE INDEX IF NOT EXISTS idx_req_endpoint ON requests(endpoint_id, latency_ms);
CREATE TABLE IF NOT EXISTS dq_log (          -- data-quality log
    issue TEXT, rows_affected INTEGER, action TEXT
);
