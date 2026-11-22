/* ── map.js ───────────────────────────────────────────────────────
 * Minimal dependency-free slippy tile map (pan / wheel-zoom / pinch).
 * Tiles: world_map/tiles/z{L}/{x}_{y}.jpg, 256px, XYZ scheme.
 * Available levels: 0-4 complete, 7 near-complete (missing z7 tiles
 * fall back to their scaled z4 parent). z5/z6 are skipped.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

    const TILE = 256;
    const LEVELS = [0, 1, 2, 3, 4, 7];   // levels with (near-)full coverage
    const MIN_ZOOM = 0, MAX_ZOOM = 7;
    // fully zoomed out = whole world spans the viewport's smaller dimension;
    // the world can never shrink below that (no tiny-map-in-a-big-window)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  class TileMap {
    /**
     * @param {HTMLElement} container
     * @param {object} cb  { onZoomChange, onPan, onMoveEnd } — all optional
     */
    constructor(container, cb = {}) {
      this.container = container;
      this.cb = cb;
      this.cx = 0.5; this.cy = 0.42;      // normalized center
      this.zoom = 1.9;                    // fractional
      this.missing = new Set();           // 'L/x/y' keys known to 404
      this.tiles = new Map();             // key -> {el, L, x, y, missing}
      this._raf = 0; this._dirty = false;
      this._anim = null;                  // {from,to,start,dur}
      this._ready = false;
      this._pointers = new Map();         // active drag pointers
      this._pinch = null;

      container.classList.add('tilemap');
      container.innerHTML = '';
      this.worldEl = document.createElement('div');
      this.worldEl.className = 'tm-world';
      this.tileLayer = document.createElement('div');
      this.tileLayer.className = 'tm-tiles';
      this.markerLayer = document.createElement('div');
      this.markerLayer.className = 'tm-markers';
      this.worldEl.append(this.tileLayer, this.markerLayer);
      container.appendChild(this.worldEl);

      this._bindEvents();
      this._ro = new ResizeObserver(() => this.invalidate());
      this._ro.observe(container);
      this.layout();
      this._ready = true;   // suppress callbacks during construction (TDZ safety)

      // preloaded list of absent z7 tiles (generated once; avoids 404 probes)
      fetch('world_map/missing.json')
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (j && j['7']) for (const k of j['7']) this.missing.add('7/' + k.replace('_', '/'));
        })
        .catch(() => { /* fall back to img.onerror discovery */ });
    }

    /* ── public API ───────────────────────────────────────────── */

    worldSize() { return TILE * Math.pow(2, this.zoom); }

    /** smallest zoom that keeps the world spanning the smaller viewport side */
    _minZoom() {
      const W = this.container.clientWidth, H = this.container.clientHeight;
      if (!W || !H) return MIN_ZOOM;
      return Math.max(MIN_ZOOM, Math.log2(Math.min(W, H) / TILE));
    }

    /** normalized world coords → layer-local px (for marker elements) */
    normToLayer(nx, ny) {
      const ws = this.worldSize();
      return { x: nx * ws, y: ny * ws };
    }

    /** lat/lon → layer-local px */
    latLonToLayer(lat, lon) {
      return this.normToLayer(PROJ.fromLatLon(lat, lon).nx, PROJ.fromLatLon(lat, lon).ny);
    }

    /** screen px → normalized world coords */
    screenToNorm(px, py) {
      const ws = this.worldSize();
      const r = this.container.getBoundingClientRect();
      return {
        nx: this.cx + (px - r.width / 2) / ws,
        ny: this.cy + (py - r.height / 2) / ws
      };
    }

    setView(cx, cy, zoom, animate = false, dur = 700) {
      if (animate) {
        this._anim = {
          from: { cx: this.cx, cy: this.cy, zoom: this.zoom },
          to: { cx: clamp(cx, 0, 1), cy: clamp(cy, 0, 1), zoom: clamp(zoom, this._minZoom(), MAX_ZOOM) },
          start: performance.now(), dur
        };
        this._tickAnim();
      } else {
        this.cx = clamp(cx, 0, 1); this.cy = clamp(cy, 0, 1);
        this.zoom = clamp(zoom, this._minZoom(), MAX_ZOOM);
        this._anim = null;
        this.layout();
      }
    }

    flyTo(lat, lon, zoom, dur = 900) {
      const n = PROJ.fromLatLon(lat, lon);
      // zoom out-in path feels better for long jumps
      this.setView(n.nx, n.ny, zoom, true, dur);
    }

    zoomBy(delta, anchorPx, anchorPy) {
      const nz = clamp(this.zoom + delta, this._minZoom(), MAX_ZOOM);
      if (nz === this.zoom) return;
      if (anchorPx === undefined) anchorPx = this.container.clientWidth / 2;
      if (anchorPy === undefined) anchorPy = this.container.clientHeight / 2;
      const n = this.screenToNorm(anchorPx, anchorPy);
      const wsNew = TILE * Math.pow(2, nz);
      const r = this.container.getBoundingClientRect();
      this.zoom = nz;
      this.cx = clamp(n.nx - (anchorPx - r.width / 2) / wsNew, 0, 1);
      this.cy = clamp(n.ny - (anchorPy - r.height / 2) / wsNew, 0, 1);
      this.layout();
    }

    destroy() { this._ro.disconnect(); }

    /* ── internals ────────────────────────────────────────────── */

    invalidate() { this._dirty = true; this._schedule(); }

    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this._anim) this._tickAnim();
        else if (this._dirty) { this._dirty = false; this.layout(); }
      });
    }

    _tickAnim() {
      const a = this._anim;
      if (!a) return;
      let t = (performance.now() - a.start) / a.dur;
      if (t >= 1) {
        this.cx = a.to.cx; this.cy = a.to.cy; this.zoom = a.to.zoom;
        this._anim = null;
        this.layout();
        if (this.cb.onMoveEnd) this.cb.onMoveEnd();
        return;
      }
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      this.cx = a.from.cx + (a.to.cx - a.from.cx) * e;
      this.cy = a.from.cy + (a.to.cy - a.from.cy) * e;
      this.zoom = a.from.zoom + (a.to.zoom - a.from.zoom) * e;
      this.layout();
      this._schedule();
    }

    _renderLevel() {
      // nearest available level; tie -> lower (fewer tiles to load)
      let best = LEVELS[0], bd = Infinity;
      for (const L of LEVELS) {
        const d = Math.abs(this.zoom - L);
        if (d < bd) { bd = d; best = L; }
      }
      return best;
    }

    layout() {
      const c = this.container;
      const W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;

      // viewport may have grown (resize/rotate) — never allow a too-small world
      const mz = this._minZoom();
      if (this.zoom < mz) this.zoom = mz;

      // clamp panning so the world stays sensibly in view
      const ws = this.worldSize();
      this.cx = (ws >= W) ? clamp(this.cx, (W / 2) / ws, 1 - (W / 2) / ws) : 0.5;
      this.cy = (ws >= H) ? clamp(this.cy, (H / 2) / ws, 1 - (H / 2) / ws) : 0.5;

      const ox = W / 2 - this.cx * ws;
      const oy = H / 2 - this.cy * ws;
      this.worldEl.style.transform = `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0)`;

      const L = this._renderLevel();
      const n = Math.pow(2, L);
      const ts = ws / n;                       // tile size on screen
      const nxa = this.cx - (W / 2) / ws;      // visible norm range
      const nxb = this.cx + (W / 2) / ws;
      const nya = this.cy - (H / 2) / ws;
      const nyb = this.cy + (H / 2) / ws;
      const x0 = clamp(Math.floor(nxa * n), 0, n - 1);
      const x1 = clamp(Math.floor(nxb * n), 0, n - 1);
      const y0 = clamp(Math.floor(nya * n), 0, n - 1);
      const y1 = clamp(Math.floor(nyb * n), 0, n - 1);

      const need = new Set();
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          need.add(L + '/' + x + '/' + y);

      // drop tiles that fell out of view
      for (const [key, t] of this.tiles) {
        if (!need.has(key)) { t.el.remove(); this.tiles.delete(key); }
      }
      // add / update
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = L + '/' + x + '/' + y;
          need.delete(key);
          let t = this.tiles.get(key);
          if (!t) {
            t = this._makeTile(L, x, y, ts);
            this.tiles.set(key, t);
            this.tileLayer.appendChild(t.el);
          }
          this._placeTile(t, x, y, ts);
        }
      }

      if (this._ready && this.cb.onZoomChange) this.cb.onZoomChange();
    }

    _makeTile(L, x, y, ts) {
      const key = L + '/' + x + '/' + y;
      const t = { L, x, y, missing: this.missing.has(key) };
      if (t.missing) {
        t.el = this._fallbackEl(L, x, y, ts);
      } else {
        const img = document.createElement('img');
        img.className = 'tm-tile';
        img.draggable = false;
        img.decoding = 'async';
        img.alt = '';
        img.src = `world_map/tiles/z${L}/${x}_${y}.jpg`;
        img.onerror = () => {
          this.missing.add(key);
          const fb = this._fallbackEl(t.L, x, y, ts);
          img.replaceWith(fb);
          t.el = fb; t.missing = true;
          this._placeTile(t, x, y, ts);
        };
        t.el = img;
      }
      return t;
    }

    /** scaled parent-tile fallback for missing tiles (z7 -> z4) */
    _fallbackEl(L, x, y, ts) {
      const el = document.createElement('div');
      el.className = 'tm-tile tm-fallback';
      if (L > 4) {
        const pL = 4, k = Math.pow(2, L - pL);   // 8 for L=7
        el.style.backgroundImage = `url(world_map/tiles/z${pL}/${x >> (L - pL)}_${y >> (L - pL)}.jpg)`;
        el._fb = { x: x & (k - 1), y: y & (k - 1), k };
      }
      return el;
    }

    _placeTile(t, x, y, ts) {
      const s = t.el.style;
      s.left = (x * ts).toFixed(2) + 'px';
      s.top = (y * ts).toFixed(2) + 'px';
      s.width = (ts + 0.6).toFixed(2) + 'px';   // +ε kills hairline seams
      s.height = (ts + 0.6).toFixed(2) + 'px';
      if (t.el._fb) {
        const f = t.el._fb;
        s.backgroundSize = `${(ts * f.k).toFixed(2)}px ${(ts * f.k).toFixed(2)}px`;
        s.backgroundPosition = `${(-f.x * ts).toFixed(2)}px ${(-f.y * ts).toFixed(2)}px`;
      }
    }

    _bindEvents() {
      const c = this.container;
      c.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.marker')) return;   // markers handle their own clicks
        if (!this._pointers.has(ev.pointerId)) {
          this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          try { c.setPointerCapture(ev.pointerId); }   // can throw for dead pointers
          catch (e) { if (e.name === 'NotFoundError') this._pointers.delete(ev.pointerId); }
        }
        if (this._pointers.size === 2) {
          const [a, b] = [...this._pointers.values()];
          this._pinch = {
            d: Math.hypot(a.x - b.x, a.y - b.y),
            zoom: this.zoom, cx: this.cx, cy: this.cy,
            mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          };
          this._anim = null;
        }
        this._anim = null;
      });

      c.addEventListener('pointermove', (ev) => {
        if (!this._pointers.has(ev.pointerId)) return;
        const p = this._pointers.get(ev.pointerId);
        const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
        p.x = ev.clientX; p.y = ev.clientY;

        if (this._pointers.size === 1) {
          const ws = this.worldSize();
          this.cx -= dx / ws;
          this.cy -= dy / ws;
          const r = c.getBoundingClientRect();
          this.cx = clamp(this.cx, -(r.width), 2);   // loose clamp; layout() tightens
          this.cy = clamp(this.cy, -(r.height), 2);
          this.layout();
          if (this.cb.onPan) this.cb.onPan();
        } else if (this._pointers.size === 2 && this._pinch) {
          const [a, b] = [...this._pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const nz = clamp(this._pinch.zoom + Math.log2(d / this._pinch.d), this._minZoom(), MAX_ZOOM);
          const wsNew = TILE * Math.pow(2, nz);
          const rect = c.getBoundingClientRect();
          const mx = this._pinch.mid.x - rect.left, my = this._pinch.mid.y - rect.top;
          const n = { // norm point under initial midpoint, at initial view
            nx: this._pinch.cx + (mx - rect.width / 2) / (TILE * Math.pow(2, this._pinch.zoom)),
            ny: this._pinch.cy + (my - rect.height / 2) / (TILE * Math.pow(2, this._pinch.zoom))
          };
          this.zoom = nz;
          this.cx = clamp(n.nx - (mx - rect.width / 2) / wsNew, 0, 1);
          this.cy = clamp(n.ny - (my - rect.height / 2) / wsNew, 0, 1);
          this.layout();
          if (this.cb.onPan) this.cb.onPan();
        }
      });

      const release = (ev) => {
        this._pointers.delete(ev.pointerId);
        if (this._pointers.size < 2) this._pinch = null;
        if (this._pointers.size === 0 && this.cb.onMoveEnd) this.cb.onMoveEnd();
      };
      c.addEventListener('pointerup', release);
      c.addEventListener('pointercancel', release);

      c.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const r = c.getBoundingClientRect();
        this._anim = null;
        this.zoomBy(-ev.deltaY * 0.0021, ev.clientX - r.left, ev.clientY - r.top);
      }, { passive: false });

      c.addEventListener('dblclick', (ev) => {
        if (ev.target.closest('.marker')) return;
        const r = c.getBoundingClientRect();
        this._anim = null;
        this.zoomBy(1, ev.clientX - r.left, ev.clientY - r.top);
      });
    }
  }

  window.TileMap = TileMap;
})();
