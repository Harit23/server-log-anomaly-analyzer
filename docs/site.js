(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var C = { ink: '#14212B', muted: '#5B6B78', trace: '#1E6E8C', alert: '#E4572E', alertInk: '#B23A16', amber: '#F2A541', amberInk: '#8A5400', rule: '#CFD8DE', paper: '#EEF2F4' };
  var MINUS = '−';

  function s(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function signed(n) { var r = Math.round(n); return (r < 0 ? MINUS : '+') + Math.abs(r).toLocaleString('en-US') + '%'; }

  function rootSvg(host, w, h, id, title, desc) {
    host.textContent = '';
    var svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, role: 'img', 'aria-labelledby': id + '-t ' + id + '-d' }, host);
    s('title', { id: id + '-t' }, svg, title);
    s('desc', { id: id + '-d' }, svg, desc);
    return svg;
  }

  /* ---------- 1. Hero seismograph ---------- */
  var heroAnimated = false;

  function drawHero(D, host) {
    var fig = document.getElementById('hero-fig');
    var W = Math.max(300, Math.floor(host.clientWidth));
    var narrow = W < 760;
    var mL = 46, mR = 14, mB = 50;
    var mT = narrow ? 34 : 44;
    var H = narrow ? 300 : 380;
    var pw = W - mL - mR, ph = H - mT - mB;
    var MAXMIN = 2880, YMAX = 4500;
    var X = function (m) { return mL + (m / MAXMIN) * pw; };
    var Y = function (v) { return mT + ph - (Math.min(v, YMAX) / YMAX) * ph; };

    var p99 = D.series.minute.p99;
    var pts = [];
    for (var i = 0; i < MAXMIN; i += 5) {
      var mx = 0;
      for (var j = i; j < i + 5 && j < MAXMIN; j++) if (p99[j] > mx) mx = p99[j];
      pts.push([i + 2.5, mx]);
    }

    var svg = rootSvg(host, W, H, 'hero',
      'Page speed over 48 hours, with three slowdowns marked',
      'A line chart of the slowest 1 percent of visit times for each 5-minute stretch across two days. The line stays low most of the time and jumps up during three problems: checkout got slow, the whole site slowed down, and search started failing. The checker raised an alarm within 5 minutes of each one.');

    // grid
    var g = s('g', {}, svg);
    [0, 2000, 4000].forEach(function (v) {
      s('line', { x1: mL, x2: W - mR, y1: Y(v), y2: Y(v), stroke: C.rule, 'stroke-width': v === 0 ? 1.2 : 1, 'stroke-dasharray': v === 0 ? '' : '2 4' }, g);
      s('text', { x: mL - 8, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 12.5, fill: C.muted }, g, v === 4000 ? '4,000 ms' : fmt(v));
    });
    var tickStep = 360; // 6 hours
    for (var m = 0; m <= MAXMIN; m += tickStep) {
      var hour = (m / 60) % 24;
      var big = m % 1440 === 0;
      s('line', { x1: X(m), x2: X(m), y1: mT, y2: mT + ph + (big ? 8 : 4), stroke: big ? '#AFBCC5' : C.rule, 'stroke-width': 1 }, g);
      if (m < MAXMIN) s('text', { x: X(m) + (m === 0 ? 0 : 0), y: mT + ph + 22, 'text-anchor': m === 0 ? 'start' : 'middle', 'font-size': 12.5, fill: C.muted }, g, hour + 'h');
    }
    s('text', { x: X(720), y: mT + ph + 42, 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 600, fill: C.ink }, g, 'Day 1');
    s('text', { x: X(2160), y: mT + ph + 42, 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 600, fill: C.ink }, g, 'Day 2');

    // incidents
    var names = { 'checkout-db-slowdown': 'Checkout got slow', 'global-cache-failure': 'Whole site slowed down', 'search-error-burst': 'Search started failing' };
    var truth = D.detection.truth;
    var bands = s('g', {}, svg);
    var placed = [];
    var labels = [];
    truth.forEach(function (t, idx) {
      var x0 = X(t.start_min), x1 = Math.max(X(t.end_min), x0 + 7);
      s('rect', { x: x0, y: mT, width: x1 - x0, height: ph, fill: C.alert, 'fill-opacity': 0.16 }, bands);
      s('line', { x1: x0, x2: x0, y1: mT, y2: mT + ph, stroke: C.alert, 'stroke-opacity': 0.55, 'stroke-width': 1 }, bands);
      labels.push({ t: t, cx: (x0 + x1) / 2, idx: idx });
    });

    // trace
    var d = '';
    pts.forEach(function (p, k) { d += (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); });
    s('path', { d: d, class: 'trace-line', pathLength: 1, fill: 'none', stroke: C.trace, 'stroke-width': narrow ? 1.1 : 1.3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

    // labels + alarm dots
    var lab = s('g', {}, svg);
    var useBadges = narrow;
    fig.setAttribute('data-labels', useBadges ? 'badges' : 'inline');
    labels.forEach(function (L) {
      var t = L.t, tt = t.start_min / MAXMIN;
      var wrap = s('g', { class: 'reveal', style: '--t:' + tt.toFixed(3) }, lab);
      var txt = names[t.name] || t.name;
      if (useBadges) {
        s('line', { x1: L.cx, x2: L.cx, y1: mT - 10, y2: mT, stroke: C.alert, 'stroke-width': 1 }, wrap);
        s('circle', { cx: L.cx, cy: mT - 20, r: 10, fill: C.alert }, wrap);
        s('text', { x: L.cx, y: mT - 16, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 800, fill: '#fff' }, wrap, String(L.idx + 1));
      } else {
        var est = txt.length * 7.4 + 4;
        var row = 0, anchor = 'start', done = false;
        while (!done && row < 3) {
          var opts = ['start', 'end'];
          for (var q = 0; q < opts.length && !done; q++) {
            var a = opts[q];
            var x0 = a === 'start' ? L.cx - 3 : L.cx + 3 - est;
            var x1 = x0 + est;
            if (x0 < mL - 40 || x1 > W - mR + 4) continue;
            var clash = placed.some(function (p) { return p.row === row && x0 < p.x1 + 12 && x1 > p.x0 - 12; });
            if (!clash) { placed.push({ row: row, x0: x0, x1: x1 }); anchor = a; done = true; }
          }
          if (!done) row++;
        }
        var ty = mT - 14 - row * 20;
        s('line', { x1: L.cx, x2: L.cx, y1: ty + 5, y2: mT, stroke: C.alert, 'stroke-width': 1 }, wrap);
        s('text', { x: anchor === 'start' ? L.cx - 3 : L.cx + 3, y: ty, 'text-anchor': anchor, 'font-size': 14, 'font-weight': 600, fill: C.alertInk }, wrap, txt);
      }
      // alarm dot at start + delay
      var am = t.start_min + (t.delay_min || 0);
      var bucket = Math.min(pts.length - 1, Math.floor(am / 5));
      var ay = Y(pts[bucket][1]);
      var dw = s('g', { class: 'reveal', style: '--t:' + (am / MAXMIN).toFixed(3) }, lab);
      s('circle', { cx: X(am), cy: ay, r: 9, fill: C.alert, 'fill-opacity': 0.18 }, dw);
      s('circle', { cx: X(am), cy: ay, r: 5, fill: C.alert, stroke: C.paper, 'stroke-width': 2 }, dw);
    });

    if (!heroAnimated) { fig.classList.add('animate'); heroAnimated = true; setTimeout(function () { fig.classList.remove('animate'); }, 3200); }
  }

  /* ---------- 2. Histogram ---------- */
  function drawHist(D, host) {
    var W = Math.max(300, Math.floor(host.clientWidth));
    var narrow = W < 560;
    var mL = 4, mR = 4, mB = 40, rowH = 40;
    var mT = 8 + rowH * 2 + 14;
    var H = narrow ? 330 : 380;
    var pw = W - mL - mR, ph = H - mT - mB;
    var A = D.describe.ALL;
    var edges = D.series.hist.edges, counts = D.series.hist.counts;
    var X = function (v) { return mL + (v / 1000) * pw; };
    var maxC = Math.max.apply(null, counts);
    var Y = function (c) { return mT + ph - (c / maxC) * ph; };

    var svg = rootSvg(host, W, H, 'hist',
      'Histogram of visit times with median, average and p99 marked',
      'Most visits finish in under 200 milliseconds, with a long thin tail of slow visits stretching right. The median is ' + Math.round(A.median) + ' ms, the average is ' + Math.round(A.mean) + ' ms and the slowest 1 percent start at ' + Math.round(A.p99) + ' ms.');

    var step = edges[1] - edges[0];
    var bars = s('g', {}, svg);
    edges.forEach(function (e, i) {
      var tail = e >= A.p99 - step;
      var x0 = X(e), x1 = X(e + step);
      var y = Y(counts[i]);
      s('rect', { x: x0 + 0.5, y: y, width: Math.max(1, x1 - x0 - 1), height: mT + ph - y, rx: 1.5, fill: tail ? C.amber : C.trace, 'fill-opacity': tail ? 0.7 : 0.34 }, bars);
    });
    s('line', { x1: mL, x2: W - mR, y1: mT + ph, y2: mT + ph, stroke: '#AFBCC5' }, svg);
    (narrow ? [0, 200, 400, 600, 1000] : [0, 200, 400, 600, 800, 1000]).forEach(function (v) {
      var anchor = v === 0 ? 'start' : (v === 1000 ? 'end' : 'middle');
      s('line', { x1: X(v), x2: X(v), y1: mT + ph, y2: mT + ph + 5, stroke: '#AFBCC5' }, svg);
      s('text', { x: X(v), y: mT + ph + 22, 'text-anchor': anchor, 'font-size': 12.5, fill: C.muted }, svg, v === 1000 ? '1,000 ms' : fmt(v));
    });

    function marker(val, row, color, textColor, title, sub, dash) {
      var x = X(val);
      var yTop = 8 + row * rowH;
      s('line', { x1: x, x2: x, y1: yTop, y2: mT + ph, stroke: color, 'stroke-width': 2, 'stroke-dasharray': dash || '' }, svg);
      var t = s('text', { x: x + 8, y: yTop + 13, 'font-size': 15, 'font-weight': 800, fill: textColor }, svg, title);
      s('text', { x: x + 8, y: yTop + 30, 'font-size': 13, fill: C.muted }, svg, sub);
    }
    marker(A.median, 0, C.trace, C.trace, 'Median ' + Math.round(A.median) + ' ms', narrow ? 'most people' : 'what most people get');
    marker(A.mean, 1, C.ink, C.ink, 'Average ' + Math.round(A.mean) + ' ms', narrow ? 'almost nobody' : 'a spot almost nobody is in', '4 3');
    marker(A.p99, 0, '#D88A1B', C.amberInk, 'p99 ' + Math.round(A.p99) + ' ms', narrow ? 'slowest 1%' : 'the slowest 1% start here');

    if (W >= 640) {
      var tx = X(760);
      s('text', { x: tx, y: mT + ph - 64, 'font-size': 14, fill: C.amberInk, 'font-weight': 600 }, svg, 'The long tail');
      s('text', { x: tx, y: mT + ph - 46, 'font-size': 13, fill: C.muted }, svg, 'Rare, but very slow');
    }
  }

  /* ---------- 3. Diverging bars ---------- */
  function drawDiverge(D, host) {
    var W = Math.max(300, Math.floor(host.clientWidth));
    var I = D.theory_vs_experiment.mean_hides_p99.incident_all_traffic;
    var rows = [
      { name: 'Average', note: 'what most reports show', v: I.mean_change_pct, color: C.trace },
      { name: 'Median', note: 'the typical visit', v: I.median_change_pct, color: C.trace },
      { name: 'p99', note: 'the slowest 1% of visits', v: I.p99_change_pct, color: C.amber, textColor: C.amberInk }
    ];
    var numSize = W < 560 ? 28 : 36;
    var numW = numSize * 3.7;
    var mL = 12, rowH = 84, mT = 6, H = mT + rows.length * rowH + 6;
    var x0 = mL + 10;
    var vmax = Math.max.apply(null, rows.map(function (r) { return r.v; }));
    var scale = (W - numW - x0 - 6) / vmax;

    var svg = rootSvg(host, W, H, 'div',
      'How much the average, median and p99 changed during the problem',
      'The average rose ' + Math.round(I.mean_change_pct) + ' percent, the median changed by ' + Math.round(I.median_change_pct) + ' percent (essentially nothing), and the p99 rose ' + Math.round(I.p99_change_pct) + ' percent.');

    rows.forEach(function (r, i) {
      var y = mT + i * rowH;
      s('text', { x: x0 + 12, y: y + 17, 'font-size': 16, 'font-weight': 800, fill: C.ink }, svg, r.name);
      s('text', { x: x0 + 12 + r.name.length * 9.6 + 12, y: y + 17, 'font-size': 14, fill: C.muted }, svg, r.note);
      var by = y + 28, bh = 30;
      var w = Math.abs(r.v) * scale;
      var bx = r.v >= 0 ? x0 : x0 - Math.max(3, w);
      s('rect', { x: bx, y: by, width: Math.max(3, w), height: bh, rx: 2, fill: r.color }, svg);
      var numX = r.v >= 0 ? x0 + w + 12 : x0 + 12;
      s('text', { x: numX, y: by + bh / 2 + numSize * 0.35, 'font-size': numSize, 'font-weight': 800, fill: r.textColor || C.ink, style: 'letter-spacing:-0.02em' }, svg, signed(r.v));
    });
    s('line', { x1: x0, x2: x0, y1: mT + 20, y2: H - 4, stroke: C.ink, 'stroke-width': 1.5 }, svg);
  }

  /* ---------- 5. Pages ---------- */
  var FRIENDLY = {
    '/': ['Home page', ''],
    '/api/search': ['Search', ''],
    '/api/products': ['Products', ''],
    '/api/login': ['Login', ''],
    '/api/checkout': ['Checkout', ''],
    '/static/app.js': ['App file', '']
  };

  function drawPages(D, host) {
    host.textContent = '';
    var keys = Object.keys(FRIENDLY).sort(function (a, b) { return D.describe[b].p99 - D.describe[a].p99; });
    var LO = 10, HI = 2000;
    var ticks = [30, 100, 300, 1000];
    var head = document.createElement('div');
    head.className = 'pg-head';
    head.innerHTML = '<span></span><div class="axis-host"></div><span class="th-num">Median</span><span class="th-num p99">p99</span>';
    host.appendChild(head);
    var axisHost = head.querySelector('.axis-host');
    var list = document.createElement('div');
    host.appendChild(list);

    var logx = function (v, w) { return (Math.log(v) - Math.log(LO)) / (Math.log(HI) - Math.log(LO)) * w; };

    keys.forEach(function (k, i) {
      var st = D.describe[k];
      var row = document.createElement('div');
      row.className = 'pg-row';
      row.innerHTML = '<div class="name">' + FRIENDLY[k][0] + '<small>' + FRIENDLY[k][1] + '</small></div>' +
        '<div class="track"></div>' +
        '<div class="num med" data-label="Median">' + fmt(st.median) + '<i> ms</i></div>' +
        '<div class="num p99" data-label="p99">' + fmt(st.p99) + '<i> ms</i></div>';
      list.appendChild(row);
    });

    // measure after layout
    var tracks = list.querySelectorAll('.track');
    var w = Math.floor(tracks[0].clientWidth) || 300;
    var padL = 8, padR = 8, iw = w - padL - padR;

    var asvg = s('svg', { viewBox: '0 0 ' + w + ' 22', height: 22, 'aria-hidden': 'true' }, axisHost);
    ticks.forEach(function (t) {
      s('text', { x: padL + logx(t, iw), y: 15, 'text-anchor': 'middle' }, asvg, fmt(t) + (t === 1000 ? ' ms' : ''));
    });
    if (window.innerWidth <= 640) head.style.marginBottom = '4px';

    keys.forEach(function (k, i) {
      var st = D.describe[k];
      var h = 34;
      var svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, height: h, role: 'img', 'aria-label': FRIENDLY[k][0] + ': median ' + fmt(st.median) + ' ms, p99 ' + fmt(st.p99) + ' ms' }, tracks[i]);
      var id = 'gr' + i;
      var defs = s('defs', {}, svg);
      var lg = s('linearGradient', { id: id, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
      s('stop', { offset: 0, 'stop-color': C.trace }, lg);
      s('stop', { offset: 1, 'stop-color': C.amber }, lg);
      ticks.forEach(function (t) {
        s('line', { x1: padL + logx(t, iw), x2: padL + logx(t, iw), y1: 0, y2: h, stroke: C.rule, 'stroke-width': 1 }, svg);
      });
      var xm = padL + logx(st.median, iw), xp = padL + logx(st.p99, iw);
      s('rect', { x: xm, y: h / 2 - 3.5, width: xp - xm, height: 7, rx: 3.5, fill: 'url(#' + id + ')', 'fill-opacity': 0.55 }, svg);
      s('circle', { cx: xm, cy: h / 2, r: 6.5, fill: C.trace, stroke: C.paper, 'stroke-width': 2 }, svg);
      s('circle', { cx: xp, cy: h / 2, r: 6.5, fill: C.amber, stroke: C.paper, 'stroke-width': 2 }, svg);
    });
  }

  /* ---------- text fill ---------- */
  function fillText(D) {
    var det = D.detection;
    var maxDelay = Math.max.apply(null, det.truth.map(function (t) { return t.delay_min; }));
    var map = {
      requests: fmt(D.meta.requests),
      detected: det.detected,
      total: det.total,
      falseAlarms: det.main_rule_false_alerts_on_clean,
      cleanDays: det.clean_days,
      maxDelay: maxDelay,
      windowMin: D.meta.window_minutes,
      z: D.meta.z_threshold
    };
    document.querySelectorAll('[data-fill]').forEach(function (el) {
      var v = map[el.getAttribute('data-fill')];
      if (v != null) el.textContent = v;
    });
  }

  /* ---------- boot ---------- */
  function observe(host, fn) {
    var last = 0, t;
    function run() { var w = Math.floor(host.clientWidth); if (w && w !== last) { last = w; fn(); } }
    run();
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { clearTimeout(t); t = setTimeout(run, 80); }).observe(host);
    } else {
      window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(run, 120); });
    }
  }

  fetch('data/results.json').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (D) {
    fillText(D);
    var jobs = [
      ['hero-chart', drawHero], ['hist-chart', drawHist], ['diverge-chart', drawDiverge], ['pages-chart', drawPages]
    ];
    jobs.forEach(function (j) {
      var host = document.getElementById(j[0]);
      observe(host, function () { j[1](D, host); });
    });
  }).catch(function (err) {
    console.warn('Could not load chart data:', err);
  });
})();
