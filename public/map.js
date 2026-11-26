// The chart: a low-res pixelated base (land, grid) with a crisp overlay (route, ship, labels).
import { ROUTE, LAND, LANDMARKS, CUM_NM, TOTAL_NM, pointAt } from './data.js';

const LON_MIN = -28, LON_MAX = 362, LAT_MAX = 72, LAT_MIN = -78;

const C = {
  sea: '#16307a', sea2: '#1b3a8c', grid: '#2a4aa6',
  land: '#4a8c3a', landHi: '#6fb04a', coast: '#0e2a14', ice: '#d8e4f0',
  route: '#7fa8ff', routeDone: '#ffe27a', ship: '#ffffff', mark: '#ff9a3c',
};

export class ChartMap {
  constructor(base, over) {
    this.base = base; this.over = over;
    this.mode = 'region'; // 'region' | 'world'
    this.nm = 0; this.rivals = [];
    this.resize();
  }

  resize() {
    const w = this.base.parentElement.clientWidth || 360;
    this.W = w; this.H = Math.round(w * 0.62);
    // base is drawn at one third of the size, then scaled up pixelated
    this.lw = Math.floor(this.W / 3); this.lh = Math.floor(this.H / 3);
    this.base.width = this.lw; this.base.height = this.lh;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.over.width = this.W * dpr; this.over.height = this.H * dpr;
    this.dpr = dpr;
    this.base.style.height = this.over.style.height = this.H + 'px';
    this.draw();
  }

  setMode(m) { this.mode = m; this.draw(); }
  toggle() { this.setMode(this.mode === 'region' ? 'world' : 'region'); return this.mode; }

  // projection: returns {x, y} in CSS px for a lon/lat, using the current view
  view() {
    const cur = pointAt(this.nm);
    if (this.mode === 'world') {
      const sx = this.W / (LON_MAX - LON_MIN);
      const sy = this.H / (LAT_MAX - LAT_MIN);
      const k = Math.min(sx, sy * 1.3);
      return { k, ky: Math.min(sy, k), cx: (LON_MAX + LON_MIN) / 2, cy: (LAT_MAX + LAT_MIN) / 2 };
    }
    const k = this.W / 80; // 80 degrees of longitude across
    return { k, ky: k, cx: cur.lon, cy: cur.lat };
  }

  proj(lon, lat, v = this.view()) {
    return { x: this.W / 2 + (lon - v.cx) * v.k, y: this.H / 2 - (lat - v.cy) * v.ky };
  }

  draw(nmOverride) {
    const nm = nmOverride ?? this.nm;
    this.nm = nm;
    const v = this.view();
    this.drawBase(v);
    this.drawOver(v);
  }

  drawBase(v) {
    const g = this.base.getContext('2d');
    const s = 1 / 3;
    g.imageSmoothingEnabled = false;
    g.fillStyle = C.sea; g.fillRect(0, 0, this.lw, this.lh);
    // latitude bands
    const lat = (d) => this.H / 2 - (d - v.cy) * v.ky;
    g.fillStyle = C.sea2;
    for (const [a, b] of [[-30, -20], [20, 30], [-60, -50], [60, 70]]) {
      const y1 = lat(a) * s, y2 = lat(b) * s;
      g.fillRect(0, Math.min(y1, y2), this.lw, Math.abs(y2 - y1));
    }
    // grid every 30 degrees
    g.strokeStyle = C.grid; g.lineWidth = 1;
    g.beginPath();
    for (let lo = -30; lo <= 390; lo += 30) {
      const x = Math.round((this.W / 2 + (lo - v.cx) * v.k) * s) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, this.lh);
    }
    for (let la = -90; la <= 90; la += 30) {
      const y = Math.round(lat(la) * s) + 0.5;
      g.moveTo(0, y); g.lineTo(this.lw, y);
    }
    g.stroke();
    // land at three offsets
    for (const off of [-360, 0, 360]) {
      for (let i = 0; i < LAND.length; i++) {
        const poly = LAND[i];
        g.beginPath();
        poly.forEach(([lon, la], j) => {
          const x = (this.W / 2 + (lon + off - v.cx) * v.k) * s, y = lat(la) * s;
          j ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.closePath();
        const south = i === LAND.length - 1;
        g.fillStyle = south ? C.ice : C.land; g.fill();
        g.strokeStyle = south ? '#9fb4c8' : C.coast; g.stroke();
      }
    }
  }

  drawOver(v) {
    const g = this.over.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const cur = this.nm;

    // route: remaining dashed, done solid gold
    const path = (a, b) => {
      let started = false;
      g.beginPath();
      const steps = Math.ceil((b - a) / 150) + 1;
      for (let i = 0; i <= steps; i++) {
        const p = pointAt(a + ((b - a) * i) / steps);
        const q = this.proj(p.lon, p.lat, v);
        if (!started) { g.moveTo(q.x, q.y); started = true; } else g.lineTo(q.x, q.y);
      }
      g.stroke();
    };
    g.lineWidth = 2; g.setLineDash([4, 4]); g.strokeStyle = C.route; path(cur, TOTAL_NM);
    g.setLineDash([]); g.lineWidth = 2.5; g.strokeStyle = C.routeDone; if (cur > 0) path(0, cur);

    // landmarks
    g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    const done = (m) => m.nm <= cur;
    const seenNames = new Set();
    for (const m of LANDMARKS) {
      const q = this.proj(m.lon, m.lat, v);
      if (q.x < -20 || q.x > this.W + 20 || q.y < -10 || q.y > this.H + 10) continue;
      g.fillStyle = done(m) ? C.routeDone : C.mark;
      g.fillRect(Math.round(q.x) - 3, Math.round(q.y) - 3, 6, 6);
      g.strokeStyle = '#000'; g.lineWidth = 1; g.setLineDash([]); g.strokeRect(Math.round(q.x) - 3.5, Math.round(q.y) - 3.5, 7, 7);
      if (this.mode === 'region' && !seenNames.has(m.name + Math.round(m.lon / 100))) {
        seenNames.add(m.name + Math.round(m.lon / 100));
        this.label(g, m.name, q.x + 7, q.y);
      }
    }

    // rivals
    for (const r of this.rivals || []) {
      const p = pointAt(r.nm);
      const q = this.proj(p.lon, p.lat, v);
      if (q.x < -8 || q.x > this.W + 8 || q.y < -8 || q.y > this.H + 8) continue;
      g.fillStyle = r.out ? '#888' : r.color;
      g.beginPath(); g.moveTo(q.x, q.y - 5); g.lineTo(q.x + 4, q.y + 3); g.lineTo(q.x - 4, q.y + 3); g.closePath(); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
      if (this.mode === 'region') this.label(g, r.name.split(' ').pop() + (r.out ? ' (out)' : ''), q.x + 7, q.y - 2, r.out ? '#bbb' : r.color);
    }

    // ship
    const me = pointAt(cur);
    const q = this.proj(me.lon, me.lat, v);
    const next = pointAt(Math.min(TOTAL_NM, cur + 150));
    const q2 = this.proj(next.lon, next.lat, v);
    const ang = Math.atan2(q2.y - q.y, q2.x - q.x);
    g.save(); g.translate(q.x, q.y); g.rotate(ang);
    g.fillStyle = C.ship; g.strokeStyle = '#000'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, 5); g.lineTo(-4, 0); g.lineTo(-6, -5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.arc(q.x, q.y, 11, 0, 7); g.stroke(); g.setLineDash([]);
  }

  label(g, text, x, y, color = '#fff') {
    g.lineWidth = 3; g.strokeStyle = '#000'; g.lineJoin = 'round';
    g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }

  // Slide the ship along the route from one distance to another.
  animate(from, to, ms = 700, rivals) {
    if (rivals) this.rivals = rivals;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(to - from) < 1) { this.draw(to); return Promise.resolve(); }
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.draw(from + (to - from) * e);
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }
}
