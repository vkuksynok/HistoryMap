/* ── app.js ───────────────────────────────────────────────────────
 * Wires everything together: map view ⇄ time window ⇄ markers,
 * side list, category filters, search, popup, playback, keyboard.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const { CATS, TAGS, TAG_GROUPS, ENTRIES } = window.HIST_DATA;
  const { t, plural, entryName, entryPlace, entryDesc, entrySrc, catLabel, tourField, visibleInLang } = I18N;
  const $ = (id) => document.getElementById(id);

  /* entry text can carry HTML (imported/exported JSON) — always escape it */
  const esc = (s) => String(s).replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  window.esc = esc;   // editor.js renders entry fields too

  /* ── state ──────────────────────────────────────────────────── */
  const S = {
    cats: new Set(Object.keys(CATS)),     // enabled categories
    tagKinds: new Set(),                  // enabled 'kind' tag filters (empty = all)
    tagEvs: new Set(),                    // enabled historical-event tag filters
    showEvents: true,
    showPersons: true,
    search: '',
    selected: null,
    playing: false,
    speed: 30,                            // years / second
    markerEls: new Map(),                 // id -> element
    normCache: new Map(),                 // id -> {nx, ny}
    clusterEls: new Map(),                // cell key -> cluster bubble el
    markerCell: new Map(),                // marker id -> cell key (for hover sync)
    contemp: null,                        // anchor figure for contemporaries mode
    fan: null,                            // active hover fan-out ({ids, els, timer})
    lastListRender: 0,
    listDirty: true,
    _listKey: ''
  };

  const FLY_ZOOM = 5.2;
  const CLUSTER_Z = 5.0, CLUSTER_CELL = 90;   // low-zoom clustering (layer px per cell)
  const FAN_GAP = 32;                      // px: dots closer than this count as a pile (dot = 26px)
  const FAN_STEP = 36;                     // px between fanned pins
  const FAN_CLOSE_MS = 240;
  // real-hover devices only — on touch there is no hover to fan out with
  const CAN_HOVER = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const eraKey = (y) =>
    y < -800 ? 'early_civ' :
    y < 500 ? 'antiquity' :
    y < 1450 ? 'middle' :
    y < 1750 ? 'early_modern' :
    y < 1945 ? 'modern' : 'contemporary';

  const yearsLabel = (en) =>
    en.y0 === en.y1 ? fmtYear(en.y0) :
    `${fmtYear(en.y0)} – ${en.y1 >= 2026 ? t('present') : fmtYear(en.y1)}`;

  /* ── init ───────────────────────────────────────────────────── */

  let overlay = null;

  const map = new TileMap($('map'), {
    onZoomChange: () => {
      repositionMarkers(); updateClusters(); updateStackBadges(); positionPopup(); syncLabelMode();
      if (overlay) overlay.layout(map.worldSize(), map.zoom);
    },
    onPan: () => positionPopup(),
    onMoveEnd: () => saveState()
  });

  const timeline = new Timeline($('timeline'), {
    entries: ENTRIES,
    minYear: -12000, maxYear: 2030,
    center: 1500, width: 100,
    onChange: (c, w) => { onTimeChange(false); saveStateSoon(); },
    onSelect: (en) => selectEntry(en, false),
    onEra: (era) => applyEra(era)
  });

  overlay = new Overlay(map.worldEl);

  /* URL state (?y=&w=&vs=&ve=&lat=&lon=&z=) overrides the saved view */
  const qp = new URLSearchParams(location.search);
  const urlView = qp.has('y') ? {
    y: parseFloat(qp.get('y')),
    w: parseFloat(qp.get('w')),
    vs: parseFloat(qp.get('vs')),
    ve: parseFloat(qp.get('ve')),
    lat: parseFloat(qp.get('lat')), lon: parseFloat(qp.get('lon')),
    z: parseFloat(qp.get('z'))
  } : null;

  /* restore saved view */
  try {
    if (urlView && isFinite(urlView.y)) {
      if (isFinite(urlView.lat) && isFinite(urlView.lon)) {
        const n = PROJ.fromLatLon(urlView.lat, urlView.lon);
        map.setView(n.nx, n.ny, isFinite(urlView.z) ? urlView.z : 3, false);
      } else if (isFinite(urlView.z)) {
        map.setView(map.cx, map.cy, urlView.z, false);   // zoom-only link
      }
      timeline.setWindow(urlView.y, isFinite(urlView.w) ? urlView.w : 100, false);
      if (isFinite(urlView.vs) && isFinite(urlView.ve))
        timeline.setViewRange(urlView.vs, urlView.ve);
    } else {
      const sv = JSON.parse(localStorage.getItem('histmap.view') || 'null');
      if (sv) {
        map.setView(sv.cx, sv.cy, sv.zoom);
        timeline.setWindow(sv.center, sv.width, false);
        if (isFinite(sv.vs) && isFinite(sv.ve))
          timeline.setViewRange(sv.vs, sv.ve);
      }
    }
  } catch (e) { /* ignore */ }

  if (matchMedia('(max-width: 980px)').matches) $('sidepanel').classList.add('closed');

  buildChips();
  buildPeriodSel();
  buildList();
  overlay.layout(map.worldSize(), map.zoom);
  syncLabelMode();
  onTimeChange(true);

  /* ══ markers ═════════════════════════════════════════════════ */

  function passesFilters(en) {
    if (!visibleInLang(en, I18N.lang)) return false;   // pin not in this language version
    if (!S.cats.has(en.cat)) return false;
    if (en.t === 'e' && !S.showEvents) return false;
    if (en.t === 'p' && !S.showPersons) return false;
    // tag facets: within a facet row any match passes, rows combine with AND
    if (S.tagKinds.size || S.tagEvs.size) {
      const tg = en.tags || [];
      if (S.tagKinds.size && !tg.some(k => S.tagKinds.has(k))) return false;
      if (S.tagEvs.size && !tg.some(k => S.tagEvs.has(k))) return false;
    }
    if (S.contemp) {
      // contemporaries mode: only figures whose life overlapped the anchor's
      if (en.t !== 'p') return false;
      if (!(en.y0 <= S.contemp.y1 && en.y1 >= S.contemp.y0)) return false;
    }
    if (S.search) {
      const q = S.search.toLowerCase();
      // match the display language and the canonical English fields alike
      if (!(en.name.toLowerCase().includes(q) || entryName(en).toLowerCase().includes(q) ||
            (en.d || '').toLowerCase().includes(q) || entryDesc(en).toLowerCase().includes(q) ||
            (en.place || '').toLowerCase().includes(q) || entryPlace(en).toLowerCase().includes(q) ||
            catLabel(CATS[en.cat]).toLowerCase().includes(q)))
        return false;
    }
    return true;
  }

  function makeMarker(en) {
    const cat = CATS[en.cat];
    const el = document.createElement('div');
    el.className = `marker c-${en.cat} t-${en.t}`;
    el.dataset.id = en.id;
    el.innerHTML =
      `<div class="dot" style="border-color:${cat.color};color:${cat.color}">${en.t === 'p' ? '👤' : cat.icon}</div>` +
      `<div class="label" style="--c:${cat.color}">${esc(entryName(en))}</div>`;
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntry(en, true); });
    el.addEventListener('mouseenter', () => hoverSync(en.id, true));
    el.addEventListener('mouseleave', () => hoverSync(en.id, false));
    map.markerLayer.appendChild(el);
    const n = PROJ.fromLatLon(en.lat, en.lon);
    S.normCache.set(en.id, n);
    placeMarker(el, n);
    void el.offsetWidth;                  // flush the pre-'on' style so the fade-in transition runs
    el.classList.add('on');
    return el;
  }

  function placeMarker(el, n) {
    const p = map.normToLayer(n.nx, n.ny);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  }

  function repositionMarkers() {
    for (const [id, el] of S.markerEls) {
      const n = S.normCache.get(id);
      if (n) placeMarker(el, n);
    }
  }

  /* ── marker clustering — at low zoom, nearby pins collapse into a
   * counted bubble; clicking drills in. Above CLUSTER_Z every pin is
   * shown individually (hover-lift handles the rest). ─────────── */

  function updateClusters() {
    unspread();                            // zoom/time/selection change ends any fan-out
    for (const el of S.markerEls.values()) el.classList.remove('clu-off');
    S.markerCell.clear();
    if (map.zoom >= CLUSTER_Z) { clearClusters(); return; }

    const ws = map.worldSize();
    const k = CLUSTER_CELL / ws;                       // cell size in norm units
    const cells = new Map();
    for (const [id, el] of S.markerEls) {
      if (el.classList.contains('sel')) continue;      // selection always solo
      const n = S.normCache.get(id);
      if (!n) continue;
      const key = Math.floor(n.nx / k) + ':' + Math.floor(n.ny / k);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ id, el, n });
    }

    const keep = new Set();
    for (const [key, arr] of cells) {
      if (arr.length < 2) continue;
      keep.add(key);
      let cx = 0, cy = 0;
      for (const it of arr) { cx += it.n.nx; cy += it.n.ny; it.el.classList.add('clu-off'); S.markerCell.set(it.id, key); }
      cx /= arr.length; cy /= arr.length;
      let cEl = S.clusterEls.get(key);
      if (!cEl) {
        cEl = document.createElement('div');
        cEl.className = 'cluster';
        cEl.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        cEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          map.setView(cEl._c.cx, cEl._c.cy, Math.min(map.zoom + 1.4, 5.6), true, 600);
        });
        map.markerLayer.appendChild(cEl);
        S.clusterEls.set(key, cEl);
      }
      cEl._c = { cx, cy };
      cEl.textContent = arr.length;
      cEl.style.left = (cx * ws) + 'px';
      cEl.style.top = (cy * ws) + 'px';
    }
    for (const [key, cEl] of S.clusterEls) {
      if (!keep.has(key)) { cEl.remove(); S.clusterEls.delete(key); }
    }
  }

  function clearClusters() {
    for (const cEl of S.clusterEls.values()) cEl.remove();
    S.clusterEls.clear();
  }

  /* ── hover fan-out ("spiderfy") — above the cluster zoom every pin is
   * shown individually, but co-located pins sit in a pile with only the
   * top one reachable. Hovering such a pile fans the pins out around
   * the hovered one (which stays put under the cursor) so each can be
   * picked individually; leaving the pile folds it back. ──────────── */

  function stackOf(el) {
    // transitive closure of "overlaps the hovered pin" over live markers
    const out = [], seen = new Set([el.dataset.id]), queue = [el];
    while (queue.length) {
      const cur = queue.shift();
      out.push(cur);
      const x1 = parseFloat(cur.style.left) || 0, y1 = parseFloat(cur.style.top) || 0;
      for (const [id2, el2] of S.markerEls) {
        if (seen.has(id2)) continue;
        if (!el2.classList.contains('on') || el2.classList.contains('clu-off')) continue;
        const x2 = parseFloat(el2.style.left) || 0, y2 = parseFloat(el2.style.top) || 0;
        if (Math.hypot(x2 - x1, y2 - y1) < FAN_GAP) { seen.add(id2); queue.push(el2); }
      }
    }
    return out;
  }

  function spreadFrom(el) {
    if (!CAN_HOVER || !el || !el.isConnected || map.zoom < CLUSTER_Z) return;
    if (S.fan) {
      clearTimeout(S.fan.timer);
      if (S.fan.ids.has(el.dataset.id)) return;   // already fanned (pin-to-pin moves)
      unspread();
    }
    const group = stackOf(el);
    if (group.length < 2) return;

    const setPos = (e, x, y) => {
      e.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
      e.classList.add('fan');
    };
    setPos(el, 0, 0);                      // anchor stays under the cursor — no flicker
    const sibs = group.filter(g => g !== el)
      .sort((a, b) => (a.dataset.id < b.dataset.id ? -1 : 1));   // stable layout across rebuilds
    const k = sibs.length;
    const r = Math.max(34, k * FAN_STEP / (2 * Math.PI));
    let sa = 0, sr = r;
    sibs.forEach((g, i) => {
      if (i < 8) {                         // up to 8 pins: one ring around the anchor
        const ang = i * 2 * Math.PI / Math.min(k, 8);
        setPos(g, r * Math.cos(ang), r * Math.sin(ang));
      } else {                             // beyond that: Archimedean spiral
        if (i === 8) sa = 2 * Math.PI;
        sa += FAN_STEP / sr;
        sr += FAN_STEP * 0.35;
        setPos(g, sr * Math.cos(sa), sr * Math.sin(sa));
      }
    });
    S.fan = { ids: new Set(group.map(g => g.dataset.id)), els: group, timer: 0 };
  }

  function scheduleFanCollapse(id) {
    if (!S.fan || !S.fan.ids.has(id)) return;
    clearTimeout(S.fan.timer);
    S.fan.timer = setTimeout(unspread, FAN_CLOSE_MS);
  }

  function unspread() {
    if (!S.fan) return;
    clearTimeout(S.fan.timer);
    for (const el of S.fan.els) {
      el.classList.remove('fan');
      el.style.transform = 'translate(-50%, -50%)';
    }
    S.fan = null;
  }

  /* ── pile badge — a co-located pile shows only its top pin, so the top
   * pin wears a small count badge telling there is more under it (hover
   * fans the pile open). Same overlap rule as stackOf, computed over all
   * live markers via a grid so a zoom-animation frame stays cheap. ─── */

  function updateStackBadges() {
    const badged = new Map();              // top marker el -> pile size
    if (map.zoom >= CLUSTER_Z) {
      const g = FAN_GAP;
      const cells = new Map(), live = [];
      for (const el of S.markerEls.values()) {
        if (!el.classList.contains('on') || el.classList.contains('clu-off')) continue;
        el._px = parseFloat(el.style.left) || 0;
        el._py = parseFloat(el.style.top) || 0;
        live.push(el);
        const key = Math.floor(el._px / g) + ':' + Math.floor(el._py / g);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(el);
      }
      // paint order on a pile: hover > list-highlight > selected > DOM order
      const zOf = e => e.classList.contains('hl') ? 11 : e.classList.contains('sel') ? 10 : 0;
      const seen = new Set();
      for (const start of live) {
        if (seen.has(start)) continue;
        const comp = [start]; seen.add(start);
        for (let qi = 0; qi < comp.length; qi++) {
          const cur = comp[qi], gx = Math.floor(cur._px / g), gy = Math.floor(cur._py / g);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const arr = cells.get((gx + dx) + ':' + (gy + dy));
            if (!arr) continue;
            for (const o of arr)
              if (!seen.has(o) && Math.hypot(o._px - cur._px, o._py - cur._py) < g) { seen.add(o); comp.push(o); }
          }
        }
        if (comp.length < 2) continue;
        let top = comp[0];                 // the pin painted last is the visible one
        for (const o of comp) {
          const dz = zOf(o) - zOf(top);
          if (dz > 0 || (dz === 0 && (top.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING))) top = o;
        }
        badged.set(top, comp.length);
      }
    }
    for (const el of S.markerEls.values()) {
      const n = badged.get(el);
      if (n) {
        if (!el._pileN) {
          el._pileN = document.createElement('span');
          el._pileN.className = 'pile-n';
          el.appendChild(el._pileN);
        }
        if (el._pileN.textContent !== String(n)) el._pileN.textContent = n;
        el.classList.add('piled');
      } else if (el._pileN) {
        el._pileN.remove();
        el._pileN = null;
        el.classList.remove('piled');
      }
    }
  }

  function syncLabelMode() {
    map.markerLayer.classList.toggle('show-labels', map.zoom >= 3.6);
    declutterLabels();
  }

  /* greedy label collision avoidance (screen-space bboxes) */
  function declutterLabels() {
    const els = [...S.markerEls.values()];
    if (map.zoom < 3.6 || els.length > 220) {
      els.forEach(e => e.classList.remove('lbl-off')); return;
    }
    const items = els.map(el => {
      const lab = el.querySelector('.label');
      return {
        el, sel: el.classList.contains('sel'),
        x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
        w: lab.textContent.length * 6.2 + 22
      };
    }).sort((a, b) => (b.sel - a.sel) || (a.y - b.y));
    const taken = [];
    for (const it of items) {
      const x0 = it.x - it.w / 2, x1 = it.x + it.w / 2, y0 = it.y + 16, y1 = it.y + 34;
      const hit = taken.some(r => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
      it.el.classList.toggle('lbl-off', hit && !it.sel);
      if (!hit) taken.push({ x0, x1, y0, y1 });
    }
  }

  /* list ⇄ marker hover sync */
  function hoverSync(id, on) {
    const m = S.markerEls.get(id);
    if (m) m.classList.toggle('hl', on);
    if (on) spreadFrom(m);                 // pile under the cursor (or under a list hover) fans open
    else scheduleFanCollapse(id);
    // if the marker is inside a cluster, light the bubble up too
    const ck = S.markerCell.get(id);
    const cEl = ck && S.clusterEls.get(ck);
    if (cEl) cEl.classList.toggle('hl', on);
    const li = document.querySelector('.li[data-id="' + id + '"]');
    if (li) {
      li.classList.toggle('hl', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ══ time window → markers + list ════════════════════════════ */

  function onTimeChange(force) {
    const ws = timeline.winStart, we = timeline.winEnd;
    const center = timeline.center;
    const now = performance.now();

    const active = new Set();
    const activeObjs = [];
    for (const en of ENTRIES) {
      const inTime = en.y1 >= ws && en.y0 <= we;
      const on = inTime && passesFilters(en);
      if (on) {
        active.add(en.id);
        activeObjs.push(en);
        if (!S.markerEls.has(en.id)) S.markerEls.set(en.id, makeMarker(en));
        const el = S.markerEls.get(en.id);
        el.classList.toggle('fresh', en.y0 >= ws);               // started inside window
      }
    }
    for (const [id, el] of S.markerEls) {
      if (!active.has(id)) {
        el.classList.remove('on', 'sel', 'hl', 'piled');   // dying markers must not glow on the way out
        const dead = el;
        setTimeout(() => { if (!dead.classList.contains('on')) { dead.remove(); if (S.markerEls.get(id) === dead) S.markerEls.delete(id); } }, 350);
        S.markerEls.delete(id);
      }
    }
    if (S.selected && !active.has(S.selected.id)) closePopup();

    overlay.update(ws, we, center, activeObjs, map.zoom);
    updateClusters();
    updateStackBadges();

    /* header */
    $('yearNow').textContent = fmtYear(Math.round(center));
    $('eraNow').textContent = t('era_' + eraKey(center));
    $('rangeNow').textContent = `${fmtYear(Math.round(ws))} — ${fmtYear(Math.round(we))}`;
    const nE = [...active].filter(id => ENTRIES.find(e => e.id === id && e.t === 'e')).length;
    const nP = active.size - nE;
    $('countNow').textContent = I18N.lang === 'uk'
      ? `${nE} ${plural(nE, 'подія', 'події', 'подій')} · ${nP} ${plural(nP, 'постать', 'постаті', 'постатей')}`
      : I18N.lang === 'de'
      ? `${nE} ${plural(nE, 'Ereignis', 'Ereignisse', 'Ereignisse')} · ${nP} ${plural(nP, 'Persönlichkeit', 'Persönlichkeiten', 'Persönlichkeiten')}`
      : I18N.lang === 'es'
      ? `${nE} ${plural(nE, 'evento', 'eventos', 'eventos')} · ${nP} ${plural(nP, 'personaje', 'personajes', 'personajes')}`
      : I18N.lang === 'pt'
      ? `${nE} ${plural(nE, 'evento', 'eventos', 'eventos')} · ${nP} ${plural(nP, 'figura', 'figuras', 'figuras')}`
      : I18N.lang === 'sv'
      ? `${nE} ${plural(nE, 'händelse', 'händelser', 'händelser')} · ${nP} ${plural(nP, 'person', 'personer', 'personer')}`
      : I18N.lang === 'fi'
      ? `${nE} ${plural(nE, 'tapahtuma', 'tapahtumaa', 'tapahtumaa')} · ${nP} ${plural(nP, 'henkilö', 'henkilöä', 'henkilöä')}`
      : I18N.lang === 'fr'
      ? `${nE} ${plural(nE, 'événement', 'événements', 'événements')} · ${nP} ${plural(nP, 'personnage', 'personnages', 'personnages')}`
      : I18N.lang === 'it'
      ? `${nE} ${plural(nE, 'evento', 'eventi', 'eventi')} · ${nP} ${plural(nP, 'personaggio', 'personaggi', 'personaggi')}`
      : I18N.lang === 'no'
      ? `${nE} ${plural(nE, 'hendelse', 'hendelser', 'hendelser')} · ${nP} ${plural(nP, 'person', 'personer', 'personer')}`
      : `${nE} ${plural(nE, 'event', 'events', 'events')} · ${nP} ${plural(nP, 'figure', 'figures', 'figures')}`;

    /* list (throttled) */
    S.listDirty = true;
    if (force || now - S.lastListRender > 180) renderList();
  }

  function visibleEntriesSorted() {
    const ws = timeline.winStart, we = timeline.winEnd;
    return ENTRIES
      .filter(en => en.y1 >= ws && en.y0 <= we && passesFilters(en))
      .sort((a, b) => (a.y0 - b.y0) || entryName(a).localeCompare(entryName(b)));
  }

  function buildList() {
    $('list').addEventListener('click', (ev) => {
      const item = ev.target.closest('.li');
      if (!item) return;
      const en = ENTRIES.find(e => e.id === item.dataset.id);
      if (en) selectEntry(en, true);
    });
    $('list').addEventListener('mouseover', (ev) => {
      const item = ev.target.closest('.li');
      if (item) hoverSync(item.dataset.id, true);
    });
    $('list').addEventListener('mouseout', (ev) => {
      const item = ev.target.closest('.li');
      if (item) hoverSync(item.dataset.id, false);
    });
  }

  function renderList() {
    S.lastListRender = performance.now();
    S.listDirty = false;
    const arr = visibleEntriesSorted();
    // skip identical rebuilds — playback re-renders this every ~200ms
    const key = arr.map(e => e.id).join(',') + '|' + (S.selected ? S.selected.id : '');
    if (key === S._listKey) return;
    S._listKey = key;
    const listEl = $('list');
    listEl.innerHTML = arr.map(en => {
      const cat = CATS[en.cat];
      return `<div class="li${S.selected === en ? ' sel' : ''}" data-id="${esc(en.id)}">
        <span class="li-ic" style="background:${cat.color}22;color:${cat.color}">${en.t === 'p' ? '👤' : cat.icon}</span>
        <span class="li-main">
          <span class="li-name">${esc(entryName(en))}</span>
          <span class="li-meta">${yearsLabel(en)} · ${esc(entryPlace(en))}</span>
        </span>
      </div>`;
    }).join('') || `<div class="li-empty">${t('listEmpty')}</div>`;
  }

  /* ══ selection & popup ═══════════════════════════════════════ */

  function selectEntry(en, fly) {
    S.selected = en;
    timeline.selected = en;
    timeline.draw();
    for (const [id, el] of S.markerEls) el.classList.toggle('sel', id === en.id);
    updateClusters();
    updateStackBadges();
    renderList();
    const li = document.querySelector(`.li[data-id="${CSS.escape(en.id)}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
    openPopup(en);
    if (fly) map.flyTo(en.lat, en.lon, Math.max(map.zoom, FLY_ZOOM));
    if ($('sidepanel').classList.contains('closed')) $('sidepanel').classList.remove('closed');
  }

  function openPopup(en) {
    const cat = CATS[en.cat];
    let extra = '';
    if (en.t === 'p') {
      const c = Math.round(timeline.center);
      if (c >= en.y0 && c <= en.y1) {
        const age = c - en.y0;
        extra = `<div class="pp-age">${I18N.lang === 'uk'
          ? `На ${fmtYear(c)} рік — ${age} ${plural(age, 'рік', 'роки', 'років')}`
          : I18N.lang === 'de'
          ? `Im Jahr ${fmtYear(c)} — ${age} ${plural(age, 'Jahr', 'Jahre', 'Jahre')} alt`
          : I18N.lang === 'es'
          ? `${age} ${plural(age, 'año', 'años', 'años')} en ${fmtYear(c)}`
          : I18N.lang === 'pt'
          ? `${age} ${plural(age, 'ano', 'anos', 'anos')} em ${fmtYear(c)}`
          : I18N.lang === 'sv'
          ? `År ${fmtYear(c)} — ${age} år gammal`
          : I18N.lang === 'fi'
          ? `Vuonna ${fmtYear(c)} — ${age} ${plural(age, 'vuosi', 'vuotta', 'vuotta')} vanha`
          : I18N.lang === 'fr'
          ? `En ${fmtYear(c)} — ${age} ${plural(age, 'an', 'ans', 'ans')}`
          : I18N.lang === 'it'
          ? `${age} ${plural(age, 'anno', 'anni', 'anni')} nel ${fmtYear(c)}`
          : I18N.lang === 'no'
          ? `I ${fmtYear(c)} — ${age} år gammel`
          : `Aged ${age} in ${fmtYear(c)}`}</div>`;
      }
    }
    const tagChips = (en.tags || []).filter(k => TAGS[k])
      .map(k => { const tg = TAGS[k]; return `<span class="pp-tag">${tg.icon} ${esc(catLabel(tg))}</span>`; })
      .join('');
    $('popup').innerHTML =
      `<div class="pp-head">
         <span class="pp-ic" style="background:${cat.color}22;color:${cat.color}">${en.t === 'p' ? '👤' : cat.icon}</span>
         <span class="pp-t"><b>${esc(entryName(en))}</b>
           <small>${yearsLabel(en)} · ${esc(entryPlace(en))} · ${esc(catLabel(cat))}</small></span>
         <button class="pp-x" title="${t('closeTitle')}">×</button>
       </div>
       ${tagChips ? `<div class="pp-tags">${tagChips}</div>` : ''}
       <p class="pp-desc">${esc(entryDesc(en))}</p>
       ${en.src ? `<div class="pp-src">📖 ${esc(entrySrc(en))}</div>` : ''}
       <div class="pp-foot">${extra}${en.t === 'p' ?
         `<button class="pp-ctmp">${S.contemp && S.contemp.id === en.id ? t('exitContemporaries') : t('contemporaries')}</button>` : ''}<button class="pp-zoom">${t('zoomTo')}</button></div>`;
    $('popup').classList.add('open');
    $('popup').querySelector('.pp-x').onclick = closePopup;
    const ctmpBtn = $('popup').querySelector('.pp-ctmp');
    if (ctmpBtn) ctmpBtn.onclick = () => toggleContemp(en);
    $('popup').querySelector('.pp-zoom').onclick = () => map.flyTo(en.lat, en.lon, Math.max(map.zoom, FLY_ZOOM));
    positionPopup();
  }

  /* ── contemporaries: show every figure whose life overlapped the
   * anchor's — the window slides to cover their lifetime ────────── */
  function toggleContemp(en) {
    if (S.contemp && S.contemp.id === en.id) S.contemp = null;
    else {
      S.contemp = en;
      timeline.setWindow((en.y0 + en.y1) / 2, Math.min(800, Math.max(60, en.y1 - en.y0 + 40)));
    }
    onTimeChange(true);
    openPopup(en);
    if (S.contemp) {
      const n = [...S.markerEls.keys()].filter(id => ENTRIES.find(e => e.id === id && e.t === 'p')).length - 1;
      toast(I18N.lang === 'uk'
        ? `✨ ${entryName(en)}: ${n} ${plural(n, 'сучасник', 'сучасники', 'сучасників')} — Esc або ✨, щоб вийти`
        : I18N.lang === 'de'
        ? `✨ ${n} ${plural(n, 'Zeitgenosse', 'Zeitgenossen', 'Zeitgenossen')} von ${entryName(en)} — Esc oder ✨ zum Beenden`
        : I18N.lang === 'es'
        ? `✨ ${n} ${plural(n, 'coetáneo', 'coetáneos', 'coetáneos')} de ${entryName(en)} — Esc o ✨ para salir`
        : I18N.lang === 'pt'
        ? `✨ ${n} ${plural(n, 'contemporâneo', 'contemporâneos', 'contemporâneos')} de ${entryName(en)} — Esc ou ✨ para sair`
        : I18N.lang === 'sv'
        ? `✨ ${n} ${plural(n, 'samtidig', 'samtidiga', 'samtidiga')} med ${entryName(en)} — Esc eller ✨ för att avsluta`
        : I18N.lang === 'fi'
        ? `✨ ${entryName(en)}: ${n} ${plural(n, 'aikalainen', 'aikalaista', 'aikalaista')} — Esc tai ✨ lopettaaksesi`
        : I18N.lang === 'fr'
        ? `✨ ${n} ${plural(n, 'contemporain', 'contemporains', 'contemporains')} de ${entryName(en)} — Échap ou ✨ pour quitter`
        : I18N.lang === 'it'
        ? `✨ ${n} ${plural(n, 'contemporaneo', 'contemporanei', 'contemporanei')} di ${entryName(en)} — Esc o ✨ per uscire`
        : I18N.lang === 'no'
        ? `✨ ${n} ${plural(n, 'samtidig', 'samtidige', 'samtidige')} med ${entryName(en)} — Esc eller ✨ for å avslutte`
        : `✨ ${n} ${plural(n, 'contemporary', 'contemporaries', 'contemporaries')} of ${en.name} — Esc or ✨ to exit`);
    }
  }

  function positionPopup() {
    const pp = $('popup');
    if (!pp.classList.contains('open') || !S.selected) return;
    const el = S.markerEls.get(S.selected.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = $('map').getBoundingClientRect();
    let x = r.left - c.left + r.width / 2;
    let y = r.top - c.top - 8;
    // flip below the pin when the popup (with its tag badges) won't fit above
    const need = pp.offsetHeight || 280;
    pp.classList.toggle('below', y < Math.min(need + 16, c.height - 60));
    if (pp.classList.contains('below')) y = r.bottom - c.top + 8;
    pp.style.left = clamp(x, 170, c.width - 170) + 'px';
    pp.style.top = Math.max(8, y) + 'px';
  }

  function closePopup() {
    $('popup').classList.remove('open');
    S.selected = null;
    timeline.selected = null;
    timeline.draw();
    if (S.contemp) { S.contemp = null; onTimeChange(true); }
    for (const [, el] of S.markerEls) el.classList.remove('sel');
    updateClusters();
    updateStackBadges();
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ══ chips (category + type filters) ═════════════════════════ */

  function buildChips() {
    const wrap = $('chips');
    const tagRow = (group, cls) => {
      const on = group === 'kind' ? S.tagKinds : S.tagEvs;
      return `<div class="tagrow"><span class="tagrow-l">${esc(catLabel(TAG_GROUPS[group]))}</span>` +
        Object.entries(TAGS).filter(([, tg]) => tg.group === group)
          .map(([k, tg]) =>
            `<button class="chip ${cls}${on.has(k) ? ' on' : ''}" data-k="tag:${group}:${k}" title="${esc(catLabel(tg))}">
               <span>${tg.icon}</span>${esc(catLabel(tg))}</button>`).join('') +
        `</div>`;
    };
    wrap.innerHTML =
      `<button class="chip tchip${S.showEvents ? ' on' : ''}" data-k="__e">${t('chipEvents')}</button>` +
      `<button class="chip tchip${S.showPersons ? ' on' : ''}" data-k="__p">${t('chipFigures')}</button>` +
      `<span class="chip-sep"></span>` +
      Object.entries(CATS).map(([k, c]) =>
        `<button class="chip cchip on" data-k="${k}" style="--c:${c.color}">
           <span>${c.icon}</span>${esc(catLabel(c))}</button>`).join('') +
      `<span class="chip-sep"></span><button class="chip allchip" data-k="__all">${t('chipReset')}</button>` +
      tagRow('kind', 'gchip') + tagRow('ev', 'echip');
    // onclick (not addEventListener): buildChips reruns on every langchange,
    // a second listener would double-toggle every click
    wrap.onclick = (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const k = chip.dataset.k;
      if (k === '__all') {
        S.cats = new Set(Object.keys(CATS));
        S.showEvents = S.showPersons = true;
        S.tagKinds.clear();
        S.tagEvs.clear();
      } else if (k === '__e') S.showEvents = !S.showEvents;
      else if (k === '__p') S.showPersons = !S.showPersons;
      else if (k.startsWith('tag:')) {
        const [, group, key] = k.split(':');
        const set = group === 'kind' ? S.tagKinds : S.tagEvs;
        if (set.has(key)) set.delete(key); else set.add(key);
      }
      else if (S.cats.has(k)) S.cats.delete(k);
      else S.cats.add(k);
      for (const c of wrap.querySelectorAll('.cchip'))
        c.classList.toggle('on', S.cats.has(c.dataset.k));
      wrap.querySelector('[data-k="__e"]').classList.toggle('on', S.showEvents);
      wrap.querySelector('[data-k="__p"]').classList.toggle('on', S.showPersons);
      for (const c of wrap.querySelectorAll('.gchip, .echip')) {
        const [, group, key] = c.dataset.k.split(':');
        c.classList.toggle('on', (group === 'kind' ? S.tagKinds : S.tagEvs).has(key));
      }
      onTimeChange(true);
    };
  }

  /* ══ search ══════════════════════════════════════════════════ */

  const drop = document.createElement('div');
  drop.id = 'searchDrop';
  document.body.appendChild(drop);

  function allTimeMatches(q) {
    q = q.toLowerCase();
    return ENTRIES.filter(en =>
      visibleInLang(en, I18N.lang) &&
      (en.name.toLowerCase().includes(q) || entryName(en).toLowerCase().includes(q) ||
      en.place.toLowerCase().includes(q) || entryPlace(en).toLowerCase().includes(q) ||
      (en.d || '').toLowerCase().includes(q) || entryDesc(en).toLowerCase().includes(q))
    ).slice(0, 12);
  }

  function renderSearchDrop() {
    if (!S.search) { drop.classList.remove('open'); drop.innerHTML = ''; return; }
    const hits = allTimeMatches(S.search);
    drop.innerHTML = hits.map(en => {
      const c = CATS[en.cat];
      return `<div class="sd-item" data-id="${esc(en.id)}" style="--c:${c.color}">
        <span class="sd-ic">${en.t === 'p' ? '👤' : c.icon}</span>
        <span class="sd-name">${esc(entryName(en))}</span>
        <span class="sd-meta">${yearsLabel(en)}</span>
      </div>`;
    }).join('') || `<div class="sd-empty">${t('searchEmpty')}</div>`;
    const r = $('search').getBoundingClientRect();
    const w = Math.max(300, Math.min(r.width, innerWidth - 24));
    drop.style.width = w + 'px';
    drop.style.left = Math.max(10, Math.min(r.left, innerWidth - w - 10)) + 'px';
    drop.style.top = (r.bottom + 6) + 'px';
    drop.classList.add('open');
  }

  function jumpToEntry(en) {
    if (!en) return;
    $('search').value = '';
    S.search = '';
    drop.classList.remove('open');
    const span = Math.min(800, Math.max(60, en.y1 - en.y0 + 40));
    timeline.setWindow((en.y0 + en.y1) / 2, span);
    selectEntry(en, true);
  }

  drop.addEventListener('pointerdown', (ev) => {
    const it = ev.target.closest('.sd-item');
    if (!it) return;
    ev.preventDefault();                       // keep the input focused
    jumpToEntry(ENTRIES.find(e => e.id === it.dataset.id));
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('#searchDrop') && ev.target !== $('search'))
      drop.classList.remove('open');
  }, true);

  $('search').addEventListener('input', (ev) => {
    S.search = ev.target.value.trim();
    onTimeChange(true);
    renderSearchDrop();
  });
  $('search').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.target.value = ''; S.search = ''; onTimeChange(true); renderSearchDrop(); ev.target.blur();
    } else if (ev.key === 'Enter') {
      const hits = allTimeMatches(S.search);
      if (hits.length) jumpToEntry(hits[0]);
    }
    ev.stopPropagation();
  });

  /* ══ playback & transport ════════════════════════════════════ */

  const SPEEDS = [10, 30, 90, 270];

  function stepYears(dy) {
    timeline.setWindow(timeline.center + dy, timeline.width);
  }

  $('btnStart').onclick = () => timeline.animateCenterTo(timeline.minYear + timeline.width / 2 + 1);
  $('btnEnd').onclick = () => timeline.animateCenterTo(timeline.maxYear - timeline.width / 2 - 1);
  $('btnPrev').onclick = () => stepYears(-timeline.width);
  $('btnNext').onclick = () => stepYears(timeline.width);
  $('btnPlay').onclick = togglePlay;
  const speedLabel = () => t('speedFmt').replace('{n}', S.speed);
  $('btnSpeed').textContent = speedLabel();
  $('btnSpeed').onclick = () => {
    S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
    $('btnSpeed').textContent = speedLabel();
  };
  $('btnWider').onclick = () => timeline.setWindow(timeline.center, timeline.width * 1.5);
  $('btnNarrower').onclick = () => timeline.setWindow(timeline.center, timeline.width / 1.5);

  /* ══ period selection: era click · Period menu · exact years ══ */

  function applyEra(era) {
    const span = era.y1 - era.y0 + 1;
    timeline.setWindow((era.y0 + era.y1) / 2, span);
    timeline.animateViewTo(era.y0 - span * 0.03, era.y1 + span * 0.03);
  }

  function buildPeriodSel() {
    const sel = $('periodSel');
    if (!sel) return;
    sel.innerHTML =
      `<option value="" hidden></option>` +
      `<option value="__all">${esc(t('allHistory'))}</option>` +
      Timeline.ERAS.map(e => `<option value="${e.key}">${esc(t('era_' + e.key))}</option>`).join('');
    sel.selectedIndex = 0;                 // action menu — no persistent state to keep in sync
  }

  $('periodSel').addEventListener('change', () => {
    const sel = $('periodSel');
    const v = sel.value;
    sel.selectedIndex = 0;
    if (v === '__all') {
      timeline.setWindow((timeline.minYear + timeline.maxYear) / 2,
                         timeline.maxYear - timeline.minYear);
      timeline.animateViewTo(timeline.minYear, timeline.maxYear);
    } else {
      const era = Timeline.ERAS.find(e => e.key === v);
      if (era) applyEra(era);
    }
  });

  /* timeline scale zoom (the map-style zoom for the time axis itself) */
  $('btnScaleIn').onclick = () => { timeline._anim = null; timeline.zoomView(0.6, timeline.center); };
  $('btnScaleOut').onclick = () => { timeline._anim = null; timeline.zoomView(1 / 0.6, timeline.center); };
  $('btnScaleFit').onclick = () => timeline.animateViewTo(timeline.minYear, timeline.maxYear);

  /* exact period via the from–to year fields (negative = BC) */
  function applyFromTo() {
    const a = parseInt($('yearFrom').value, 10), b = parseInt($('yearTo').value, 10);
    if (!isFinite(a) || !isFinite(b)) return;
    const y0 = Math.min(a, b), y1 = Math.max(a, b);
    const span = Math.max(11, y1 - y0 + 1);
    timeline.setWindow((y0 + y1) / 2, span);
    timeline.animateViewTo(y0 - span * 0.06, y1 + span * 0.06);
  }
  for (const id of ['yearFrom', 'yearTo']) {
    $(id).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { applyFromTo(); ev.target.blur(); }
      ev.stopPropagation();
    });
    $(id).addEventListener('change', applyFromTo);
  }

  function togglePlay() {
    S.playing = !S.playing;
    $('btnPlay').textContent = S.playing ? t('pause') : t('play');
    $('btnPlay').classList.toggle('playing', S.playing);
    if (S.playing) {
      lastEra = eraKey(timeline.center);      // announce era crossings while playing
      if (timeline.center >= timeline.maxYear - timeline.width / 2 - 2)
        timeline.setWindow(timeline.minYear + timeline.width / 2 + 1, timeline.width, false);
      lastT = performance.now();
      requestAnimationFrame(playLoop);
    }
  }

  let lastT = 0;
  function playLoop() {
    if (!S.playing) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    let c = timeline.center + dt * S.speed;
    if (c >= timeline.maxYear - timeline.width / 2) {
      c = timeline.maxYear - timeline.width / 2;
      timeline.setWindow(c, timeline.width);
      togglePlay();
      return;
    }
    timeline.setWindow(c, timeline.width);
    const er = eraKey(timeline.center);
    if (er !== lastEra) {
      lastEra = er;
      toast('🏛 ' + t('era_' + er) + ' — ' + t('eraNote_' + er));
    }
    requestAnimationFrame(playLoop);
  }

  let lastEra = null;

  /* ══ keyboard ════════════════════════════════════════════════ */

  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const w = timeline.width;
    switch (ev.key) {
      case 'ArrowLeft': stepYears(ev.shiftKey ? -w : -w / 4); ev.preventDefault(); break;
      case 'ArrowRight': stepYears(ev.shiftKey ? w : w / 4); ev.preventDefault(); break;
      case 'Home': timeline.animateCenterTo(timeline.minYear + w / 2 + 1); ev.preventDefault(); break;
      case 'End': timeline.animateCenterTo(timeline.maxYear - w / 2 - 1); ev.preventDefault(); break;
      case ' ': togglePlay(); ev.preventDefault(); break;
      case '+': case '=': map.zoomBy(0.6); break;
      case '-': case '_': map.zoomBy(-0.6); break;
      case 'Escape':
        if (S.contemp) { S.contemp = null; onTimeChange(true); }
        closePopup(); stopTour(); $('help').classList.remove('open');
        break;
    }
  });

  /* ══ misc UI ═════════════════════════════════════════════════ */

  $('btnPanel').onclick = () => $('sidepanel').classList.toggle('closed');
  $('btnHelp').onclick = () => $('help').classList.add('open');
  $('helpClose').onclick = () => $('help').classList.remove('open');
  $('help').addEventListener('click', (ev) => { if (ev.target === $('help')) $('help').classList.remove('open'); });

  $('btnZoomIn').onclick = () => map.zoomBy(0.8);
  $('btnZoomOut').onclick = () => map.zoomBy(-0.8);
  $('btnGlobe').onclick = () => map.setView(0.55, 0.42, map._minZoom(), true);   // full-world view

  const spanLabel = () => {
    const n = Math.round(timeline.width);
    const L = I18N.lang;
    const word = L === 'uk' ? 'Вікно' : L === 'de' ? 'Fenster' : L === 'es' ? 'Ventana' : L === 'pt' ? 'Janela' : L === 'sv' ? 'Fönster' : L === 'fi' ? 'Ikkuna' : L === 'fr' ? 'Fenêtre' : L === 'it' ? 'Finestra' : L === 'no' ? 'Vindu' : L === 'da' ? 'Vindue' : 'Window';
    const yr = L === 'uk' ? ['рік', 'роки', 'років']
             : L === 'de' ? ['Jahr', 'Jahre', 'Jahre']
             : L === 'es' ? ['año', 'años', 'años']
             : L === 'pt' ? ['ano', 'anos', 'anos']
             : L === 'sv' ? ['år', 'år', 'år']
             : L === 'fi' ? ['vuosi', 'vuotta', 'vuotta']
             : L === 'fr' ? ['an', 'ans', 'ans']
             : L === 'it' ? ['anno', 'anni', 'anni']
             : L === 'no' ? ['år', 'år', 'år']
             : L === 'da' ? ['år', 'år', 'år']
             : ['year', 'years', 'years'];
    $('spanLabel').textContent = `${word}: ${n} ${plural(n, yr[0], yr[1], yr[2])}`;
  };
  spanLabel();
  const origSetWindow = timeline.setWindow.bind(timeline);
  timeline.setWindow = (c, w, notify) => {
    origSetWindow(c, w, notify);
    spanLabel();
  };

  /* periodic list refresh while window slides (play / drag) */
  setInterval(() => { if (S.listDirty) renderList(); }, 200);

  /* ══ guided tours ════════════════════════════════════════════ */

  let tour = null;   // { def, i, timer }

  function buildTourMenu() {
    $('tourMenu').innerHTML = TOURS.map((tr, i) =>
      `<button data-i="${i}"><b>${esc(tourField(tr, 'name'))}</b><small>${esc(tourField(tr, 'desc'))}</small></button>`).join('');
  }

  $('btnTours').onclick = (e) => { $('tourMenu').classList.toggle('open'); e.stopPropagation(); };
  document.addEventListener('click', () => $('tourMenu').classList.remove('open'));
  $('tourMenu').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.stopPropagation();
    $('tourMenu').classList.remove('open');
    startTour(TOURS[+b.dataset.i]);
  });

  function startTour(def) {
    stopTour();
    tour = { def, i: -1, timer: 0 };
    $('tourbar').classList.add('open');
    $('tourTitle').textContent = tourField(def, 'name');
    nextTourStep();
  }

  function nextTourStep() {
    if (!tour) return;
    tour.i++;
    if (tour.i >= tour.def.steps.length) { stopTour(); return; }
    const s = tour.def.steps[tour.i];
    timeline.setWindow(s.y, s.w || 20, false);
    onTimeChange(true);
    if (isFinite(s.lat) && isFinite(s.lon)) {
      const n = PROJ.fromLatLon(s.lat, s.lon);
      map.setView(n.nx, n.ny, s.z || 4, true, 900);
    }
    if (s.id) {
      const en = ENTRIES.find(e => e.id === s.id);
      if (en) setTimeout(() => { if (tour) selectEntry(en, false); }, 800);
    }
    $('tourNote').textContent = tourField(s, 'note');
    $('tourStep').textContent = (tour.i + 1) + ' / ' + tour.def.steps.length;
    clearTimeout(tour.timer);
    tour.timer = setTimeout(nextTourStep, 7000);
  }

  function stopTour() {
    if (!tour) return;
    clearTimeout(tour.timer);
    tour = null;
    $('tourbar').classList.remove('open');
  }

  $('tourNext').onclick = () => tour && nextTourStep();
  $('tourStop').onclick = stopTour;

  /* ══ URL sharing & toast ═════════════════════════════════════ */

  let urlTimer = 0;
  function syncURL() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      if (map._anim) { syncURL(); return; }        // don't snapshot mid-flight
      const ll = PROJ.toLatLon(map.cx, map.cy);
      const lat = Math.max(-78, Math.min(78, ll.lat));
      const p = new URLSearchParams({
        y: Math.round(timeline.center), w: Math.round(timeline.width),
        lat: lat.toFixed(2), lon: ll.lon.toFixed(2), z: map.zoom.toFixed(1)
      });
      if (timeline.viewStart > timeline.minYear + 1 || timeline.viewEnd < timeline.maxYear - 1) {
        p.set('vs', Math.round(timeline.viewStart));       // share the zoomed scale too
        p.set('ve', Math.round(timeline.viewEnd));
      }
      history.replaceState(null, '', '?' + p.toString());
    }, 700);
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }
  window.toast = toast;   // used by editor.js too

  $('btnShare').onclick = async () => {
    syncURL();
    clearTimeout(urlTimer); urlTimer = 0;
    const ll = PROJ.toLatLon(map.cx, map.cy);
    const lat = Math.max(-78, Math.min(78, ll.lat));    // same clamp as syncURL
    const zoomed = timeline.viewStart > timeline.minYear + 1 ||
                   timeline.viewEnd < timeline.maxYear - 1;
    const url = location.origin + location.pathname + '?y=' + Math.round(timeline.center) +
      '&w=' + Math.round(timeline.width) +
      (zoomed ? '&vs=' + Math.round(timeline.viewStart) + '&ve=' + Math.round(timeline.viewEnd) : '') +
      '&lat=' + lat.toFixed(2) +
      '&lon=' + ll.lon.toFixed(2) + '&z=' + map.zoom.toFixed(1);
    try {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied'));
    } catch (e) {
      history.replaceState(null, '', url);
      toast(t('linkInBar'));
    }
  };

  /* ══ data validation ═════════════════════════════════════════ */

  (function validateData() {
    const issues = [];
    const ids = new Set();
    for (const en of ENTRIES) {
      if (ids.has(en.id)) issues.push('duplicate id: ' + en.id);
      ids.add(en.id);
      if (en.y1 < en.y0) issues.push(en.id + ': y1 < y0');
      if (en.lat < -85 || en.lat > 85 || en.lon < -180 || en.lon > 180) issues.push(en.id + ': bad coords');
      if (!CATS[en.cat]) issues.push(en.id + ': unknown category "' + en.cat + '"');
      for (const k of (en.tags || []))
        if (!TAGS[k]) issues.push(en.id + ': unknown tag "' + k + '"');
      if (en.path && en.path.some(p => p.length !== 2 || !isFinite(p[0]) || !isFinite(p[1])))
        issues.push(en.id + ': bad path waypoint');
    }
    if (issues.length) console.warn('DATA ISSUES:\n' + issues.join('\n'));
    if (new URLSearchParams(location.search).has('validate')) {
      const d = document.createElement('pre');
      d.id = 'validateBox';
      d.textContent = issues.length ? issues.join('\n') : 'Data OK — ' + ENTRIES.length + ' entries, no issues.';
      document.body.appendChild(d);
    }
  })();

  /* ══ persistence ═════════════════════════════════════════════ */

  let saveTimer = 0;
  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 800);
  }
  function saveState() {
    try {
      localStorage.setItem('histmap.view', JSON.stringify({
        cx: map.cx, cy: map.cy, zoom: map.zoom,
        center: timeline.center, width: timeline.width,
        vs: Math.round(timeline.viewStart), ve: Math.round(timeline.viewEnd)
      }));
    } catch (e) { /* ignore */ }
    syncURL();
  }

  /* ══ service worker (installable offline app) ════════════════ */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  buildTourMenu();

  /* ══ language switch ══════════════════════════════════════════ */
  window.addEventListener('langchange', () => {
    buildChips();
    buildPeriodSel();
    buildTourMenu();
    S._listKey = '';                       // force a list rebuild
    for (const [, el] of S.markerEls) el.remove();   // labels carry entry names
    S.markerEls.clear();
    timeline.draw();                       // canvas era bands
    onTimeChange(true);                    // header, list, markers, overlay
    if (S.selected) {
      if (!visibleInLang(S.selected, I18N.lang)) { closePopup(); }
      else {
        const el = S.markerEls.get(S.selected.id);
        if (el) el.classList.add('sel');
        openPopup(S.selected);
      }
    }
    $('btnPlay').textContent = S.playing ? t('pause') : t('play');
    $('btnSpeed').textContent = speedLabel();
    spanLabel();
    if (S.search) renderSearchDrop();
  });

  console.log('History Atlas ready —', ENTRIES.length, 'entries, projection:', PROJ.name);
  window.__atlas = { map, timeline, S, selectEntry, onTimeChange };   // debugging/testing hook
})();
