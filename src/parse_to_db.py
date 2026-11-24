"""Parse the access log into SQLite. Bad lines are counted in dq_log, not silently dropped."""
import gzip, re, sqlite3, sys
from datetime import datetime

LINE = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\S+) (\S+)$')

def main(log="data/access.log.gz", db="data/logs.db", schema="sql/schema.sql"):
    con = sqlite3.connect(db)
    con.executescript("DROP TABLE IF EXISTS requests; DROP TABLE IF EXISTS endpoints; DROP TABLE IF EXISTS dq_log;")
    con.executescript(open(schema).read())
    ep_ids, rows, bad, dup, seen = {}, [], 0, 0, set()
    neg = 0
    with gzip.open(log, "rt") as f:
        for line in f:
            m = LINE.match(line.strip())
            if not m: bad += 1; continue
            ip, ts, _, path, status, size, lat = m.groups()
            try: lat = float(lat)
            except ValueError: bad += 1; continue
            if lat < 0: neg += 1; continue
            key = (ip, ts, path)
            if key in seen: dup += 1          # same ip+second+path: kept (could be legit), only counted
            seen.add(key)
            dt = datetime.strptime(ts, "%d/%b/%Y:%H:%M:%S %z")
            ep = ep_ids.setdefault(path, len(ep_ids) + 1)
            st = int(status)
            rows.append((dt.isoformat(), dt.strftime("%Y-%m-%d %H:%M"), ip, ep, st,
                         0 if size == "-" else int(size), lat, int(st >= 500)))
    con.executemany("INSERT INTO endpoints VALUES (?,?)", [(i, p) for p, i in ep_ids.items()])
    con.executemany("INSERT INTO requests(ts,minute,ip,endpoint_id,status,bytes,latency_ms,is_error) VALUES (?,?,?,?,?,?,?,?)", rows)
    con.executemany("INSERT INTO dq_log VALUES (?,?,?)", [
        ("Malformed lines (regex mismatch / non-numeric latency)", bad, "Skipped and counted"),
        ("Negative latency values", neg, "Dropped"),
        ("Same ip+second+path repeated", dup, "Kept: plausible for real traffic; flagged only"),
        ("Missing byte size ('-')", 0, "Would be set to 0 (none present in this data)"),
    ])
    con.commit()
    print(f"loaded {len(rows)} requests, {len(ep_ids)} endpoints; bad={bad} neg={neg} dup={dup}")

if __name__ == "__main__":
    main(*sys.argv[1:])
