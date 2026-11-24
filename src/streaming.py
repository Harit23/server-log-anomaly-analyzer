"""Streaming data structures required by the brief (DSA component).

1. SlidingWindowMedian  - two heaps (max-heap + min-heap) with lazy deletion.
                          O(log n) per update, O(1) median.
2. P2Quantile           - the P-square algorithm (Jain & Chlamtac, 1985): estimates ONE quantile
                          using only 5 numbers of memory, no matter how many values stream past.
3. LogBucketSketch      - a DDSketch-style histogram with geometric buckets. Gives a guaranteed
                          RELATIVE error (default 1%) for any percentile, and sketches can be merged.
"""
import heapq, math
from collections import deque, defaultdict


class SlidingWindowMedian:
    def __init__(self, size):
        self.size = size
        self.lo, self.hi = [], []          # lo = max-heap (stored negated), hi = min-heap
        self.window = deque()
        self.delayed = defaultdict(int)    # values scheduled for removal
        self.lo_n = self.hi_n = 0          # live (non-deleted) counts

    def _prune(self, heap, sign):
        while heap and self.delayed[sign * heap[0]] > 0:
            self.delayed[sign * heap[0]] -= 1
            heapq.heappop(heap)

    def _rebalance(self):
        if self.lo_n > self.hi_n + 1:
            heapq.heappush(self.hi, -heapq.heappop(self.lo)); self.lo_n -= 1; self.hi_n += 1
            self._prune(self.lo, -1)
        elif self.lo_n < self.hi_n:
            heapq.heappush(self.lo, -heapq.heappop(self.hi)); self.hi_n -= 1; self.lo_n += 1
            self._prune(self.hi, 1)

    def add(self, x):
        if not self.lo or x <= -self.lo[0]:
            heapq.heappush(self.lo, -x); self.lo_n += 1
        else:
            heapq.heappush(self.hi, x); self.hi_n += 1
        self.window.append(x)
        if len(self.window) > self.size:
            old = self.window.popleft()
            self.delayed[old] += 1
            if self.lo and old <= -self.lo[0]: self.lo_n -= 1
            else: self.hi_n -= 1
            self._prune(self.lo, -1); self._prune(self.hi, 1)
        self._rebalance(); self._prune(self.lo, -1); self._prune(self.hi, 1)

    def median(self):
        if not self.window: return None
        if len(self.window) % 2: return float(-self.lo[0])
        return (-self.lo[0] + self.hi[0]) / 2.0


class P2Quantile:
    def __init__(self, p):
        self.p = p; self.q = []; self.n = [0, 1, 2, 3, 4]
        self.np = [0, 2 * p, 4 * p, 2 + 2 * p, 4]; self.dn = [0, p / 2, p, (1 + p) / 2, 1]

    def add(self, x):
        if len(self.q) < 5:
            self.q.append(x); self.q.sort(); return
        q, n = self.q, self.n
        if x < q[0]: q[0] = x; k = 0
        elif x >= q[4]: q[4] = x; k = 3
        else: k = next(i for i in range(4) if q[i] <= x < q[i + 1])
        for i in range(k + 1, 5): n[i] += 1
        for i in range(5): self.np[i] += self.dn[i]
        for i in (1, 2, 3):
            d = self.np[i] - n[i]
            if (d >= 1 and n[i + 1] - n[i] > 1) or (d <= -1 and n[i - 1] - n[i] < -1):
                d = 1 if d > 0 else -1
                qp = q[i] + d / (n[i + 1] - n[i - 1]) * (
                    (n[i] - n[i - 1] + d) * (q[i + 1] - q[i]) / (n[i + 1] - n[i]) +
                    (n[i + 1] - n[i] - d) * (q[i] - q[i - 1]) / (n[i] - n[i - 1]))
                if not q[i - 1] < qp < q[i + 1]:
                    qp = q[i] + d * (q[i + d] - q[i]) / (n[i + d] - n[i])
                q[i] = qp; n[i] += d

    def value(self):
        if len(self.q) < 5:
            s = sorted(self.q); return s[min(int(self.p * len(s)), len(s) - 1)] if s else None
        return self.q[2]


class LogBucketSketch:
    def __init__(self, rel_err=0.01):
        self.gamma = (1 + rel_err) / (1 - rel_err); self.lg = math.log(self.gamma)
        self.b = defaultdict(int); self.count = 0

    def add(self, x):
        self.b[math.ceil(math.log(max(x, 1e-9)) / self.lg)] += 1; self.count += 1

    def merge(self, other):
        for k, v in other.b.items(): self.b[k] += v
        self.count += other.count

    def quantile(self, p):
        rank = p * (self.count - 1); seen = 0
        for k in sorted(self.b):
            seen += self.b[k]
            if seen > rank:
                return 2 * self.gamma ** k / (self.gamma + 1)


if __name__ == "__main__":   # self-test: compare with brute force
    import random, statistics
    random.seed(1); data = [random.lognormvariate(4, .6) for _ in range(5000)]
    sw = SlidingWindowMedian(101)
    for i, x in enumerate(data):
        sw.add(x)
        if i >= 100 and i % 250 == 0:
            assert abs(sw.median() - statistics.median(data[i - 100:i + 1])) < 1e-9
    print("SlidingWindowMedian OK")
    for p in (.5, .95, .99):
        est = P2Quantile(p); sk = LogBucketSketch()
        for x in data: est.add(x); sk.add(x)
        ex = sorted(data)[int(p * (len(data) - 1))]
        print(f"p{int(p*100)} exact={ex:.1f} P2={est.value():.1f} sketch={sk.quantile(p):.1f}")
