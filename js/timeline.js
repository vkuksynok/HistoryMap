/* ── timeline.js ──────────────────────────────────────────────────
 * Full-width horizontal timeline slider at the bottom of the screen.
 * - era bands (click a band to select that period) + adaptive year ticks
 * - ribbon of all events/persons (clickable)
 * - draggable time window (edges resize, strip drags, click on ruler
 *   seeks). Drives the map via onChange().
 * - independent view zoom: wheel / pinch / buttons zoom the scale itself,
 *   drag pans the zoomed view, golden arrows recall an off-screen window.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // piecewise scale: [year, fraction 0..1] — stretches crowded eras
  const SCALE_PTS = [
    [-12000, 0.00], [-3200, 0.045], [-1000, 0.16], [-500, 0.28], [1, 0.38],
    [500, 0.46], [1000, 0.56], [1500, 0.68], [1750, 0.78],
    [1900, 0.88], [2030, 1.00]
  ];

  const ERAS = [
    { y0: -12000, y1: -3200, key: 'prehistory',  color: '#6a7a5a' },
    { y0: -3200, y1: -800,  key: 'early_civ',    color: '#8a6d4a' },
    { y0: -800, y1: 500,    key: 'antiquity',    color: '#4a7d8a' },
    { y0: 500, y1: 1450,    key: 'middle',       color: '#6a5a9a' },
    { y0: 1450, y1: 1750,   key: 'early_modern', color: '#9a5a74' },
    { y0: 1750, y1: 1945,   key: 'modern',       color: '#8a7a4a' },
    { y0: 1945, y1: 2030,   key: 'contemporary', color: '#4a8a62' }
  ];

  /* fmtYear (localized BC/AD formatting) is provided by js/i18n.js */

  const VIEW_MIN = 10;                    // narrowest visible span, years

  class Timeline {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} opts { entries, minYear, maxYear, center, width,
     *                        onChange(center,width), onSelect(entry),
     *                        onEra(era) }
     */
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      Object.assign(this, {
        minYear: -12000, maxYear: 2030,
        center: 1500, width: 100,
        onChange: null, onSelect: null, onEra: null, selected: null
      }, opts);
      this.viewStart = this.minYear;       // visible portion of the scale (view zoom)
      this.viewEnd = this.maxYear;

      this.H = 118;
      this.padX = 18;
      this._touch = matchMedia('(pointer:coarse)').matches;   // wider grab zones on touch
      this._bars = [];        // ribbon bars for hit-testing
      this._drag = null;
      this._anim = null;
      this._viewAnim = null;
      this._hover = null;
      this._hoverEra = null;
      this._ptrs = new Map();              // live pointers (pinch zoom)
      this._pinch = null;

      this._roT = 0;
      new ResizeObserver(() => {           // rAF-deferred: avoids RO loop warnings
        cancelAnimationFrame(this._roT);
        this._roT = requestAnimationFrame(() => this.resize());
      }).observe(canvas.parentElement);
      this._bindEvents();
      this.resize();
      this._sorted = null;                 // draw() sorts per frame — cache it
      this._sortRev = -1;                  // invalidated via HIST_DATA.rev (editor)
    }

    /* ── scale helpers ────────────────────────────────────────── */

    _w() { return this.canvas.clientWidth - this.padX * 2; }

    yearToFrac(y) {
      const p = SCALE_PTS;
      if (y <= p[0][0]) return 0;
      if (y >= p[p.length - 1][0]) return 1;
      for (let i = 1; i < p.length; i++) {
        if (y <= p[i][0]) {
          const [y0, f0] = p[i - 1], [y1, f1] = p[i];
          return f0 + (y1 === y0 ? 0 : (y - y0) / (y1 - y0) * (f1 - f0));
        }
      }
      return 1;
    }

    fracToYear(f) {
      const p = SCALE_PTS;
      for (let i = 1; i < p.length; i++) {
        if (f <= p[i][1]) {
          const [y0, f0] = p[i - 1], [y1, f1] = p[i];
          return y0 + (f1 === f0 ? 0 : (f - f0) / (f1 - f0) * (y1 - y0));
        }
      }
      return p[p.length - 1][0];
    }

    /* view-aware mapping: the piecewise scale is laid over the whole
     * history, then the visible range [viewStart..viewEnd] is stretched
     * across the canvas — zooming composes with the era stretch */
    yearToX(y) {
      const f0 = this.yearToFrac(this.viewStart), f1 = this.yearToFrac(this.viewEnd);
      return this.padX + (this.yearToFrac(y) - f0) / Math.max(1e-9, f1 - f0) * this._w();
    }

    xToYear(x) {
      const f0 = this.yearToFrac(this.viewStart), f1 = this.yearToFrac(this.viewEnd);
      return this.fracToYear(f0 + clamp((x - this.padX) / this._w(), 0, 1) * (f1 - f0));
    }

    get _viewZoomed() {
      return this.viewEnd - this.viewStart < (this.maxYear - this.minYear) - 0.5;
    }

    /* ── window API ───────────────────────────────────────────── */

    setWindow(center, width, notify = true) {
      this.width = clamp(width, VIEW_MIN, this.maxYear - this.minYear);
      const lo = this.minYear - this.width / 4, hi = this.maxYear + this.width / 4;
      this.center = clamp(center, lo, hi);
      this._ensureWindowVisible();
      if (notify && this.onChange) this.onChange(this.center, this.width);
      this.draw();
    }

    animateCenterTo(year) {
      this._anim = { from: this.center, to: year, start: performance.now(), dur: 380 };
      const tick = () => {
        if (!this._anim) return;
        let t = (performance.now() - this._anim.start) / this._anim.dur;
        if (t >= 1) {
          this.center = this._anim.to; this._anim = null;
        } else {
          const e = 1 - Math.pow(1 - t, 3);
          this.center = this._anim.from + (this._anim.to - this._anim.from) * e;
          requestAnimationFrame(tick);
        }
        this._ensureWindowVisible();
        if (this.onChange) this.onChange(this.center, this.width);
        this.draw();
      };
      requestAnimationFrame(tick);
    }

    get winStart() { return this.center - this.width / 2; }
    get winEnd() { return this.center + this.width / 2; }

    /* ── view (zoom) API ──────────────────────────────────────── */

    setViewRange(y0, y1) {
      this._viewAnim = null;               // an in-flight zoom must not override this
      const full = this.maxYear - this.minYear;
      const span = clamp(y1 - y0, VIEW_MIN, full);
      this.viewStart = clamp(y0, this.minYear, this.maxYear - span);
      this.viewEnd = this.viewStart + span;
      this.draw();
    }

    zoomView(k, anchorYear) {
      // k multiplies the visible span: >1 zooms out, <1 zooms in;
      // anchorYear keeps its relative position inside the view
      this._viewAnim = null;
      const full = this.maxYear - this.minYear;
      const span = clamp((this.viewEnd - this.viewStart) * k, VIEW_MIN, full);
      const t = (anchorYear - this.viewStart) / Math.max(1e-9, this.viewEnd - this.viewStart);
      let v0 = anchorYear - t * span;
      v0 = clamp(v0, this.minYear, this.maxYear - span);
      this.viewStart = v0;
      this.viewEnd = v0 + span;
      this.draw();
    }

    animateViewTo(y0, y1) {
      const full = this.maxYear - this.minYear;
      const span = clamp(y1 - y0, VIEW_MIN, full);
      const t0 = clamp(y0, this.minYear, this.maxYear - span);
      const t1 = t0 + span;
      this._viewAnim = { f0: this.viewStart, f1: this.viewEnd, t0, t1,
                         start: performance.now(), dur: 420 };
      const tick = () => {
        const a = this._viewAnim;
        if (!a) return;
        let t = (performance.now() - a.start) / a.dur;
        if (t >= 1) {
          this.viewStart = a.t0; this.viewEnd = a.t1; this._viewAnim = null;
        } else {
          const e = 1 - Math.pow(1 - t, 3);
          this.viewStart = a.f0 + (a.t0 - a.f0) * e;
          this.viewEnd = a.f1 + (a.t1 - a.f1) * e;
        }
        this.draw();
        if (this._viewAnim) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    /* pan/zoom the view so the time window stays reachable — runs on
     * every window change (scrub, play, resize) but never on explicit
     * view navigation, so the user can zoom away from the window */
    _ensureWindowVisible() {
      if (this._viewAnim) return;
      const full = this.maxYear - this.minYear;
      let span = this.viewEnd - this.viewStart;
      if (span < this.width * 1.02) span = Math.min(full, this.width * 1.35);
      let v0 = this.viewStart, v1 = this.viewEnd;
      if (v1 - v0 !== span) {              // widen around the current view centre
        const c = (v0 + v1) / 2;
        v0 = clamp(c - span / 2, this.minYear, this.maxYear - span);
        v1 = v0 + span;
      }
      if (this.winStart < v0) { v0 = this.winStart; v1 = v0 + span; }
      if (this.winEnd > v1) { v1 = this.winEnd; v0 = v1 - span; }
      v0 = clamp(v0, this.minYear, Math.max(this.minYear, this.maxYear - span));
      this.viewStart = v0;
      this.viewEnd = v0 + span;
    }

    resize() {
      const w = this.canvas.parentElement.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    /* ── geometry bands ───────────────────────────────────────── */

    _bands() {
      const top = 24, bot = 64;                       // ribbon area
      const sTop = 72, sBot = this.H - 22;            // window strip
      return { top, bot, sTop, sBot, ruler: this.H - 16 };
    }

    /* ── drawing ──────────────────────────────────────────────── */

    draw() {
      const ctx = this.ctx, W = this.canvas.clientWidth, H = this.H;
      const b = this._bands();
      ctx.clearRect(0, 0, W, H);

      /* era bands */
      ctx.textBaseline = 'middle';
      for (const era of ERAS) {
        const x0 = this.yearToX(era.y0), x1 = this.yearToX(era.y1);
        ctx.fillStyle = era.color + (this._hoverEra === era ? '3d' : '22');
        ctx.fillRect(x0, 0, x1 - x0, H);
        ctx.fillStyle = era.color + '55';
        ctx.fillRect(x0, 0, 1.5, H);
        if (x1 - x0 > 70) {
          ctx.fillStyle = era.color + 'cc';
          ctx.font = '600 9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(I18N.t('era_' + era.key), (x0 + x1) / 2, 11, x1 - x0 - 12);
        }
      }

      /* event ribbon */
      this._bars.length = 0;
      const lanes = [];   // last x-end per lane
      const maxLanes = 9;
      if (!this._sorted || this._sortRev !== (HIST_DATA.rev || 0)) {
        this._sorted = [...this.entries].sort((a, c) => a.y0 - c.y0);
        this._sortRev = HIST_DATA.rev || 0;
      }
      for (const en of this._sorted) {
        if (!I18N.visibleInLang(en)) continue;   // pin not in this language version
        if (en.y1 < this.viewStart || en.y0 > this.viewEnd) continue;   // outside the zoomed view
        let x0 = this.yearToX(Math.max(en.y0, this.minYear));
        let x1 = this.yearToX(Math.min(en.y1, this.maxYear));
        x1 = Math.max(x1, x0 + 2);
        let lane = lanes.findIndex(end => end + 2 < x0);
        if (lane === -1) { lane = lanes.length; }
        if (lane >= maxLanes) lane = lane % maxLanes;
        lanes[lane] = x1;
        const yy = b.top + 2 + lane * 4;
        const cat = HIST_DATA.CATS[en.cat];
        const inWin = en.y1 >= this.winStart && en.y0 <= this.winEnd;
        const isSel = this.selected === en;
        ctx.globalAlpha = inWin ? (isSel ? 1 : 0.95) : 0.28;
        ctx.fillStyle = cat.color;
        if (en.t === 'p') {
          ctx.fillRect(x0, yy, x1 - x0, 3);
          ctx.fillStyle = '#ffe9b0';
          ctx.fillRect(x0, yy - 1, 1.5, 5);        // birth tick
        } else {
          ctx.fillRect(x0, yy + 0.5, x1 - x0, 2.5);
        }
        if (isSel) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.strokeRect(x0 - 1, yy - 1.5, x1 - x0 + 2, 6);
        }
        ctx.globalAlpha = 1;
        this._bars.push({ x0, x1, y: yy, entry: en });
      }

      /* window strip */
      const wx0 = this.yearToX(this.winStart);
      const wx1 = this.yearToX(this.winEnd);
      const mid = (wx0 + wx1) / 2;
      // trough
      ctx.fillStyle = 'rgba(10,14,20,0.55)';
      ctx.fillRect(this.padX, b.sTop, this._w(), b.sBot - b.sTop);
      // window
      const grad = ctx.createLinearGradient(0, b.sTop, 0, b.sBot);
      grad.addColorStop(0, 'rgba(232,182,76,0.30)');
      grad.addColorStop(1, 'rgba(232,182,76,0.14)');
      ctx.fillStyle = grad;
      ctx.fillRect(wx0, b.sTop, wx1 - wx0, b.sBot - b.sTop);
      ctx.strokeStyle = 'rgba(232,182,76,0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx0 + 0.5, b.sTop + 0.5, wx1 - wx0 - 1, b.sBot - b.sTop - 1);
      // edge handles (roundRect is missing on older Safari — plain rect fallback)
      ctx.fillStyle = '#e8b64c';
      for (const hx of [wx0, wx1]) {
        const hw = 6, hh = b.sBot - b.sTop - 10;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(hx - 3, b.sTop + 5, hw, hh, 3);
          ctx.fill();
        } else {
          ctx.fillRect(hx - 3, b.sTop + 5, hw, hh);
        }
      }
      // center line + year
      ctx.fillStyle = '#ffd97a';
      ctx.fillRect(mid - 0.75, b.sTop - 4, 1.5, b.sBot - b.sTop + 8);
      ctx.font = '700 15px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9b0';
      const yearText = fmtYear(Math.round(this.center));
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(yearText, mid, (b.sTop + b.sBot) / 2, Math.max(30, wx1 - wx0 - 14));
      ctx.restore();
      // window edge year labels
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,233,176,0.75)';
      ctx.textAlign = 'left';
      ctx.fillText(fmtYear(Math.round(this.winStart)), wx0 + 8, b.sBot - 9);
      ctx.textAlign = 'right';
      ctx.fillText(fmtYear(Math.round(this.winEnd)), wx1 - 8, b.sBot - 9);
      // golden arrows when the window lies (partly) outside the zoomed view —
      // click one to bring the view back to the window
      const ay = (b.sTop + b.sBot) / 2;
      ctx.fillStyle = '#e8b64c';
      if (this.winStart < this.viewStart - 0.5) {
        ctx.beginPath();
        ctx.moveTo(this.padX + 11, ay - 7);
        ctx.lineTo(this.padX + 11, ay + 7);
        ctx.lineTo(this.padX + 2, ay);
        ctx.closePath();
        ctx.fill();
      }
      if (this.winEnd > this.viewEnd + 0.5) {
        const xr = W - this.padX;
        ctx.beginPath();
        ctx.moveTo(xr - 11, ay - 7);
        ctx.lineTo(xr - 11, ay + 7);
        ctx.lineTo(xr - 2, ay);
        ctx.closePath();
        ctx.fill();
      }

      /* ruler ticks — adaptive: the step grows with the visible span */
      const span = this.viewEnd - this.viewStart;
      const step = this._tickStep(span);
      const cands = [this.viewStart];
      for (let y = Math.ceil(this.viewStart / step) * step; y <= this.viewEnd; y += step)
        cands.push(y);
      cands.push(this.viewEnd);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      let lastLabelX = -100;
      for (const y of cands) {
        const x = this.yearToX(y);
        if (x < this.padX - 1 || x > W - this.padX + 1) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, b.ruler - 5, 1, 5);
        if (x - lastLabelX >= 60 && x > this.padX && x < W - this.padX) {
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.fillText(fmtYear(Math.round(y)), x, b.ruler + 7);
          lastLabelX = x;
        }
      }
      if (step >= 5) {                     // minor ticks between the labelled ones
        const minor = step / 5;
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        for (let y = Math.ceil(this.viewStart / minor) * minor; y <= this.viewEnd; y += minor) {
          const x = this.yearToX(y);
          if (x < this.padX || x > W - this.padX) continue;
          ctx.fillRect(x, b.ruler - 3, 1, 3);
        }
      }
    }

    /* nice-number ruler step targeting ~one label per 90 px */
    _tickStep(span) {
      const want = 90 / Math.max(1e-6, this._w() / span);
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
      return steps.find(s => s >= want) || 10000;
    }

    /* ── interaction ──────────────────────────────────────────── */

    _hit(px, py) {
      const b = this._bands();
      const edge = this._touch ? 15 : 7;
      if (py <= 20) {                      // era band strip → period selection
        const era = ERAS.find(e => this.yearToX(e.y0) - 3 <= px && px <= this.yearToX(e.y1) + 3);
        if (era) return { mode: 'era', era };
      }
      if (py >= b.sTop - (this._touch ? 10 : 6) && py <= b.sBot + (this._touch ? 8 : 4)) {
        const W = this.canvas.clientWidth;
        if (this.winStart < this.viewStart - 0.5 && px <= this.padX + 16) return { mode: 'fitwin' };
        if (this.winEnd > this.viewEnd + 0.5 && px >= W - this.padX - 16) return { mode: 'fitwin' };
        const wx0 = this.yearToX(this.winStart), wx1 = this.yearToX(this.winEnd);
        if (Math.abs(px - wx0) <= edge) return { mode: 'resizeL' };
        if (Math.abs(px - wx1) <= edge) return { mode: 'resizeR' };
        if (px >= wx0 && px <= wx1) return { mode: 'move', grabYear: this.xToYear(px) };
        return { mode: 'seek' };
      }
      if (py >= b.top - 4 && py <= b.bot + 4) {
        const bar = this._bars.find(t => px >= t.x0 - 2 && px <= t.x1 + 2 && Math.abs(py - t.y) <= 5);
        if (bar) return { mode: 'select', entry: bar.entry };
      }
      return { mode: 'seek' };
    }

    _bindEvents() {
      const cv = this.canvas;
      let moved = false;

      cv.addEventListener('pointerdown', (ev) => {
        const r = cv.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;
        this._ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this._ptrs.size === 2) {       // second finger → pinch zoom
          this._drag = null; this._anim = null; this._viewAnim = null;
          const [a, c] = [...this._ptrs.values()];
          this._pinch = { d: Math.hypot(a.x - c.x, a.y - c.y) || 1 };
          cv.setPointerCapture(ev.pointerId);
          ev.preventDefault();
          return;
        }
        const hit = this._hit(px, py);
        this._anim = null;
        this._viewAnim = null;
        if (hit.mode === 'seek' || hit.mode === 'select' || hit.mode === 'era') {
          this._drag = { mode: 'maybe-' + hit.mode, entry: hit.entry, era: hit.era,
                         x0: ev.clientX, y0: ev.clientY, sx: px, v0: this.viewStart };
        } else {
          this._drag = hit;
        }
        moved = false;
        cv.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });

      cv.addEventListener('pointermove', (ev) => {
        const r = cv.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;
        if (this._ptrs.has(ev.pointerId))
          this._ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this._pinch && this._ptrs.size >= 2) {
          const [a, c] = [...this._ptrs.values()];
          const d = Math.hypot(a.x - c.x, a.y - c.y) || 1;
          const anchor = this.xToYear((a.x + c.x) / 2 - r.left);
          this.zoomView(this._pinch.d / d, anchor);       // spread fingers = zoom in
          this._pinch.d = d;
          return;
        }
        if (!this._drag) {
          // hover cursor
          const h = this._hit(px, py);
          const pannable = h.mode === 'seek' && this._viewZoomed;
          cv.style.cursor =
            (h.mode === 'resizeL' || h.mode === 'resizeR') ? 'ew-resize' :
            h.mode === 'move' ? 'grab' :
            (h.mode === 'select' || h.mode === 'era' || h.mode === 'fitwin') ? 'pointer' :
            pannable ? 'grab' : 'default';
          const he = h.mode === 'era' ? h.era : null;
          if (he !== this._hoverEra) { this._hoverEra = he; this.draw(); }
          return;
        }
        const d = this._drag;
        if (d.mode === 'maybe-seek' || d.mode === 'maybe-select' ||
            d.mode === 'maybe-era' || d.mode === 'maybe-pan') {
          if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 5) {
            // zoomed view: background drags pan the view; full view: they scrub time
            d.mode = this._viewZoomed ? 'pan' : 'scrub';
          } else return;
        }
        moved = true;
        if (d.mode === 'scrub' || d.mode === 'seek') {
          this.center = this.xToYear(px);
          if (this.onChange) this.onChange(this.center, this.width);
        } else if (d.mode === 'pan') {
          const span = this.viewEnd - this.viewStart;
          let v0 = d.v0 - (px - d.sx) / this._w() * span;
          v0 = clamp(v0, this.minYear, this.maxYear - span);
          this.viewStart = v0;
          this.viewEnd = v0 + span;
        } else if (d.mode === 'move') {
          // move the window so the grabbed year stays under the pointer
          if (d.startCenter === undefined) d.startCenter = this.center;
          this.center = this.xToYear(px) - (d.grabYear - d.startCenter);
          this.center = clamp(this.center, this.minYear - this.width / 4, this.maxYear + this.width / 4);
          this._ensureWindowVisible();
          if (this.onChange) this.onChange(this.center, this.width);
        } else if (d.mode === 'resizeL') {
          const y = this.xToYear(px);
          const end = this.center + this.width / 2;
          const w = clamp(end - y, VIEW_MIN, this.maxYear - this.minYear);
          this.center = end - w / 2; this.width = w;
          this._ensureWindowVisible();
          if (this.onChange) this.onChange(this.center, this.width);
        } else if (d.mode === 'resizeR') {
          const y = this.xToYear(px);
          const start = this.center - this.width / 2;
          const w = clamp(y - start, VIEW_MIN, this.maxYear - this.minYear);
          this.center = start + w / 2; this.width = w;
          this._ensureWindowVisible();
          if (this.onChange) this.onChange(this.center, this.width);
        }
        this.draw();
      });

      const up = (ev) => {
        this._ptrs.delete(ev.pointerId);
        if (this._ptrs.size < 2) this._pinch = null;
        const d = this._drag;
        this._drag = null;
        if (!d) return;
        const r = cv.getBoundingClientRect();
        if (!moved) {
          if (d.mode === 'maybe-seek' || d.mode === 'maybe-pan') {
            this.animateCenterTo(this.xToYear(ev.clientX - r.left));
          } else if (d.mode === 'maybe-era' && this.onEra) {
            this.onEra(d.era);
          } else if (d.mode === 'maybe-select' && this.onSelect) {
            this.onSelect(d.entry);
          } else if (d.mode === 'fitwin') {
            this.animateViewTo(this.winStart - this.width * 0.15,
                               this.winEnd + this.width * 0.15);
          }
        }
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', (ev) => {
        this._ptrs.delete(ev.pointerId);
        if (this._ptrs.size < 2) this._pinch = null;
        this._drag = null;
      });

      cv.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this._anim = null;
        this._viewAnim = null;
        const r = cv.getBoundingClientRect();
        const k = ev.deltaMode === 1 ? 33 : 1;            // line-mode deltas (Firefox)
        if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {  // horizontal trackpad swipe → pan
          const span = this.viewEnd - this.viewStart;
          let v0 = this.viewStart + (ev.deltaX * k) / Math.max(1, this._w()) * span;
          v0 = clamp(v0, this.minYear, this.maxYear - span);
          this.viewStart = v0;
          this.viewEnd = v0 + span;
          this.draw();
        } else {
          // wheel anywhere on the timeline zooms the scale around the cursor
          this.zoomView(Math.exp(ev.deltaY * k * 0.0016), this.xToYear(ev.clientX - r.left));
        }
      }, { passive: false });
    }
  }

  window.Timeline = Timeline;
  Timeline.ERAS = ERAS;                    // consumed by app.js (period menu, selftest)
})();
