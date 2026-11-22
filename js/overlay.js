/* ── overlay.js ───────────────────────────────────────────────────
 * Historical layers above the tiles:
 *  - territory polygons (SVG, fading with the time window)
 *  - travel paths of peripatetic figures (entries with a `path`)
 *  - period-correct city labels (DOM, tiered by zoom)
 * All coordinates are normalized [0..1]; the layer lives inside the
 * map's world element so panning/zooming is free.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Historical borders are disabled for now — flip to true to bring back
  // the empire polygons and their labels (travel paths & city labels stay on).
  const SHOW_TERRITORIES = false;

  class Overlay {
    constructor(worldEl) {
      this.svg = document.createElementNS(SVGNS, 'svg');
      this.svg.setAttribute('class', 'ol-svg');
      this.gTerr = document.createElementNS(SVGNS, 'g');   // territory polygons
      this.gPaths = document.createElementNS(SVGNS, 'g');  // travel paths
      this.svg.append(this.gTerr, this.gPaths);
      this.labels = document.createElement('div');
      this.labels.className = 'ol-labels';
      worldEl.appendChild(this.svg);
      worldEl.appendChild(this.labels);

      this.cityEls = new Map();     // key -> {el, lat, lon, tier, names}
      this._cityBuilt = false;
      this.window = { s: 0, e: 0, c: 0 };
      this.pathsOn = new Map();     // entry.id -> {g, dot, pts}
    }

    /* ── layout (zoom changed) ─────────────────────────────────── */

    layout(worldSize, zoom) {
      this.svg.setAttribute('viewBox', '0 0 1 1');
      this.svg.setAttribute('width', worldSize);
      this.svg.setAttribute('height', worldSize);
      for (const c of this.labels.children) {
        c.style.left = (c._nx * worldSize) + 'px';
        c.style.top = (c._ny * worldSize) + 'px';
      }
      this._applyCityTiers(zoom);
    }

    /* ── update (time window changed) ──────────────────────────── */

    update(winStart, winEnd, centerYear, activeEntries, zoom) {
      this.window = { s: winStart, e: winEnd, c: centerYear };
      const w = Math.max(1, winEnd - winStart);

      // territories (optional — see SHOW_TERRITORIES)
      this.gTerr.innerHTML = '';
      const liveEmp = new Set();
      for (const t of (SHOW_TERRITORIES ? window.TERRITORIES : [])) {
        const ov = clamp(Math.min(t.y1, winEnd) - Math.max(t.y0, winStart), 0, w) / w;
        if (ov <= 0) continue;
        liveEmp.add(t.name);
        const poly = document.createElementNS(SVGNS, 'polygon');
        poly.setAttribute('points', t.p.map(([lat, lon]) => {
          const n = PROJ.fromLatLon(lat, lon);
          return n.nx.toFixed(5) + ',' + n.ny.toFixed(5);
        }).join(' '));
        poly.setAttribute('class', 'ol-terr');
        poly.setAttribute('fill', t.c);
        poly.setAttribute('stroke', t.c);
        poly.setAttribute('fill-opacity', (0.04 + 0.11 * ov).toFixed(3));
        poly.setAttribute('stroke-opacity', (0.15 + 0.45 * ov).toFixed(3));
        this.gTerr.appendChild(poly);

        // empire name label at rough centroid
        let la = 0, lo = 0;
        for (const [a, b] of t.p) { la += a; lo += b; }
        la /= t.p.length; lo /= t.p.length;
        this._label(t.name, t.c, la, lo, 0.25 + 0.6 * ov, 'ol-emp');
      }
      // hide labels of empires no longer in the window
      for (const el of this.labels.querySelectorAll('.ol-emp')) {
        if (!liveEmp.has(el.dataset.lbl)) el.style.opacity = 0;
      }

      // travel paths — diffed against the live set so the draw-in
      // animation only plays when a path appears, not on every
      // time-window tick (timeline scrubbing fires update() per frame)
      const live = new Set();
      for (const en of activeEntries) {
        if (!en.path) continue;
        live.add(en.id);
        const pts = en.path.map(([lat, lon]) => {
          const n = PROJ.fromLatLon(lat, lon);
          return n.nx.toFixed(5) + ',' + n.ny.toFixed(5);
        }).join(' ');
        let rec = this.pathsOn.get(en.id);
        if (rec && rec.pts !== pts) {            // edited in the marker editor
          rec.g.remove(); rec.dot.remove();
          this.pathsOn.delete(en.id); rec = null;
        }
        if (!rec) {
          const cat = HIST_DATA.CATS[en.cat];
          const g = document.createElementNS(SVGNS, 'polyline');
          g.setAttribute('points', pts);
          g.setAttribute('class', 'ol-path');
          g.setAttribute('stroke', cat.color);
          const s0 = en.path[0];
          const n0 = PROJ.fromLatLon(s0[0], s0[1]);
          const dot = document.createElementNS(SVGNS, 'circle');
          dot.setAttribute('cx', n0.nx); dot.setAttribute('cy', n0.ny);
          dot.setAttribute('r', 0.0012);
          dot.setAttribute('fill', cat.color);
          this.gPaths.append(g, dot);
          this.pathsOn.set(en.id, { g, dot, pts });
        }
      }
      for (const [id, rec] of this.pathsOn) {
        if (!live.has(id)) {
          rec.g.remove(); rec.dot.remove();
          this.pathsOn.delete(id);
        }
      }

      // city labels: resolve period names; hide cities not yet founded
      if (!this._cityBuilt) this._buildCities();
      for (const { el, names } of this.cityEls.values()) {
        el.style.display = centerYear >= names[0][0] ? '' : 'none';
        let name = names[0][1];
        for (const [sy, nm] of names) if (centerYear >= sy) name = nm;
        name = I18N.cityName(name);                    // localized (en fallback)
        if (el._name !== name) { el._name = name; el.textContent = name; }
      }
      this._applyCityTiers(zoom);
    }

    _label(text, color, lat, lon, alpha, cls) {
      // reuse by name to avoid rebuilding every tick
      let el = this.labels.querySelector(`[data-lbl="${CSS.escape(text)}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = cls;
        el.dataset.lbl = text;
        el.textContent = text;
        const n = PROJ.fromLatLon(lat, lon);
        el._nx = n.nx; el._ny = n.ny;
        this.labels.appendChild(el);
      }
      el.style.color = color;
      el.style.opacity = alpha;
    }

    _buildCities() {
      this._cityBuilt = true;
      for (const [lat, lon, tier, names] of window.CITIES) {
        const el = document.createElement('div');
        el.className = 'ol-city t' + tier;
        el._name = names[0][1];
        el.textContent = el._name;
        const n = PROJ.fromLatLon(lat, lon);
        el._nx = n.nx; el._ny = n.ny;
        el.style.left = (n.nx * this.svg.width.baseVal.value) + 'px';
        el.style.top = (n.ny * this.svg.height.baseVal.value) + 'px';
        this.labels.appendChild(el);
        this.cityEls.set(lat + ',' + lon, { el, names });
      }
    }

    _applyCityTiers(zoom) {
      const coarse = matchMedia('(pointer:coarse)').matches;
      const t1 = coarse ? 3.7 : 3.3, t2 = coarse ? 4.8 : 4.4;
      for (const c of this.cityEls.values()) {
        c.el.classList.toggle('vis', zoom >= (c.el.classList.contains('t1') ? t1 : t2));
      }
    }
  }

  window.Overlay = Overlay;
})();
