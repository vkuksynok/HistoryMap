/* ── selftest.js — built-in regression suite ───────────────────────
 * Open the app with ?selftest=1 to run every structural and
 * behavioural assertion in one pass. Results render in a panel and
 * in the console; the tab title becomes SELFTEST OK / FAIL.
 * Zero dependencies — same philosophy as the rest of the app.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (!new URLSearchParams(location.search).has('selftest')) return;

  const results = [];
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r === false) throw new Error('returned false');
      results.push(['PASS', name, '']);
    } catch (e) {
      results.push(['FAIL', name, (e && e.message) || String(e)]);
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  const approx = (a, b, eps, msg) => assert(Math.abs(a - b) <= eps, msg + ` (${a} vs ${b})`);

  async function run() {
    const { CATS, ENTRIES } = HIST_DATA;
    const ids = new Set(ENTRIES.map(e => e.id));

    /* ── data integrity ─────────────────────────────────────────── */
    t('data: unique ids', () => {
      const seen = new Set();
      for (const e of ENTRIES) {
        assert(!seen.has(e.id), 'duplicate id ' + e.id);
        seen.add(e.id);
      }
    });
    t('data: years ordered, coords & category valid', () => {
      for (const e of ENTRIES) {
        assert(e.y1 >= e.y0, e.id + ' y1 < y0');
        assert(e.lat >= -85 && e.lat <= 85 && e.lon >= -180 && e.lon <= 180, e.id + ' bad coords');
        assert(CATS[e.cat], e.id + ' unknown category');
        if (e.path) for (const p of e.path)
          assert(p.length === 2 && isFinite(p[0]) && isFinite(p[1]), e.id + ' bad path point');
      }
    });
    t('data: every tour step id resolves', () => {
      for (const tr of TOURS) for (const s of tr.steps)
        assert(!s.id || ids.has(s.id), tr.id + ' references missing ' + s.id);
    });
    t('data: city period names sorted, tiers valid', () => {
      for (const [lat, lon, tier, names] of CITIES) {
        for (let i = 1; i < names.length; i++)
          assert(names[i][0] > names[i - 1][0], names[0][1] + ' names unsorted');
        assert(tier === 1 || tier === 2, names[0][1] + ' bad tier');
        assert(lat >= -85 && lat <= 85 && lon >= -180 && lon <= 180, names[0][1] + ' bad coords');
      }
    });

    /* ── projection round-trips ─────────────────────────────────── */
    t('projection: lat/lon round-trip within 0.02°', () => {
      for (const lat of [-75, -60, -33, 0, 33, 60, 75]) {
        const n = PROJ.fromLatLon(lat, 37);
        const back = PROJ.toLatLon(n.nx, n.ny);
        approx(back.lat, lat, 0.02, 'lat ' + lat);
        approx(back.lon, 37, 0.001, 'lon');
      }
    });

    /* ── timeline maths ─────────────────────────────────────────── */
    t('timeline: year↔fraction round-trip', () => {
      const tl = window.__atlas.timeline;
      for (let f = 0; f <= 1.0001; f += 0.05)
        approx(tl.yearToFrac(tl.fracToYear(f)), f, 0.001, 'at f=' + f.toFixed(2));
    });
    t('timeline: fmtYear conventions', () => {
      const F = I18N.fmtYearLocale;
      assert(F(0, 'en') === '1 BC', 'year 0');
      assert(F(-44, 'en') === '44 BC', '44 BC');
      assert(F(800, 'en') === '800 AD', '800 AD');
      assert(F(1500, 'en') === '1500', '1500');
      assert(F(0, 'uk') === '1 до н. е.', 'uk year 0');
      assert(F(-44, 'uk') === '44 до н. е.', 'uk 44 BC');
      assert(F(800, 'uk') === '800', 'uk AD year is bare');
      assert(F(0, 'de') === '1 v. Chr.', 'de year 0');
      assert(F(-44, 'de') === '44 v. Chr.', 'de 44 BC');
      assert(F(800, 'de') === '800 n. Chr.', 'de 800 AD');
      assert(F(1500, 'de') === '1500', 'de 1500');
      assert(F(0, 'pt') === '1 a.C.', 'pt year 0');
      assert(F(-44, 'pt') === '44 a.C.', 'pt 44 BC');
      assert(F(800, 'pt') === '800 d.C.', 'pt 800 AD');
      assert(F(1500, 'pt') === '1500', 'pt 1500');
      assert(F(0, 'es') === '1 a. C.', 'es year 0');
      assert(F(-44, 'es') === '44 a. C.', 'es 44 BC');
      assert(F(800, 'es') === '800 d. C.', 'es 800 AD');
      assert(F(1500, 'es') === '1500', 'es 1500');
      assert(F(0, 'sv') === '1 f.Kr.', 'sv year 0');
      assert(F(-44, 'sv') === '44 f.Kr.', 'sv 44 BC');
      assert(F(800, 'sv') === '800 e.Kr.', 'sv 800 AD');
      assert(F(1500, 'sv') === '1500', 'sv 1500');
      assert(F(0, 'fi') === '1 eaa.', 'fi year 0');
      assert(F(-44, 'fi') === '44 eaa.', 'fi 44 BC');
      assert(F(800, 'fi') === '800', 'fi AD year is bare');
      assert(F(1500, 'fi') === '1500', 'fi 1500');
      assert(F(0, 'fr') === '1 av. J.-C.', 'fr year 0');
      assert(F(-44, 'fr') === '44 av. J.-C.', 'fr 44 BC');
      assert(F(800, 'fr') === '800 apr. J.-C.', 'fr 800 AD');
      assert(F(1500, 'fr') === '1500', 'fr 1500');
      assert(F(0, 'it') === '1 a.C.', 'it year 0');
      assert(F(-44, 'it') === '44 a.C.', 'it 44 BC');
      assert(F(800, 'it') === '800 d.C.', 'it 800 AD');
      assert(F(1500, 'it') === '1500', 'it 1500');
      assert(F(0, 'no') === '1 f.Kr.', 'no year 0');
      assert(F(-44, 'no') === '44 f.Kr.', 'no 44 BC');
      assert(F(800, 'no') === '800 e.Kr.', 'no 800 AD');
      assert(F(1500, 'no') === '1500', 'no 1500');
      assert(F(0, 'da') === '1 f.Kr.', 'da year 0');
      assert(F(-44, 'da') === '44 f.Kr.', 'da 44 BC');
      assert(F(800, 'da') === '800 e.Kr.', 'da 800 AD');
      assert(F(1500, 'da') === '1500', 'da 1500');
    });
    t('i18n: uk dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const u = window.DATA_UK && window.DATA_UK[e.id];
        assert(u && typeof u.n === 'string' && typeof u.p === 'string' && typeof u.d === 'string',
          e.id + ' missing uk translation');
      }
    });
    t('i18n: de dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const d = window.DATA_DE && window.DATA_DE[e.id];
        assert(d && typeof d.n === 'string' && typeof d.p === 'string' && typeof d.d === 'string',
          e.id + ' missing de translation');
      }
    });
    t('i18n: pt dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const p = window.DATA_PT && window.DATA_PT[e.id];
        assert(p && typeof p.n === 'string' && typeof p.p === 'string' && typeof p.d === 'string',
          e.id + ' missing pt translation');
      }
    });
    t('i18n: es dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const s = window.DATA_ES && window.DATA_ES[e.id];
        assert(s && typeof s.n === 'string' && typeof s.p === 'string' && typeof s.d === 'string',
          e.id + ' missing es translation');
      }
    });
    t('i18n: sv dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const s = window.DATA_SV && window.DATA_SV[e.id];
        assert(s && typeof s.n === 'string' && typeof s.p === 'string' && typeof s.d === 'string',
          e.id + ' missing sv translation');
      }
    });
    t('i18n: fi dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const f = window.DATA_FI && window.DATA_FI[e.id];
        assert(f && typeof f.n === 'string' && typeof f.p === 'string' && typeof f.d === 'string',
          e.id + ' missing fi translation');
      }
    });
    t('i18n: fr dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const f = window.DATA_FR && window.DATA_FR[e.id];
        assert(f && typeof f.n === 'string' && typeof f.p === 'string' && typeof f.d === 'string',
          e.id + ' missing fr translation');
      }
    });
    t('i18n: it dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const f = window.DATA_IT && window.DATA_IT[e.id];
        assert(f && typeof f.n === 'string' && typeof f.p === 'string' && typeof f.d === 'string',
          e.id + ' missing it translation');
      }
    });
    t('i18n: no dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const f = window.DATA_NO && window.DATA_NO[e.id];
        assert(f && typeof f.n === 'string' && typeof f.p === 'string' && typeof f.d === 'string',
          e.id + ' missing no translation');
      }
    });
    t('i18n: da dataset covers every entry', () => {
      for (const e of ENTRIES) {
        const f = window.DATA_DA && window.DATA_DA[e.id];
        assert(f && typeof f.n === 'string' && typeof f.p === 'string' && typeof f.d === 'string',
          e.id + ' missing da translation');
      }
    });
    t('i18n: uk UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('uk').includes(k), 'uk missing key ' + k);
    });
    t('i18n: de UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('de').includes(k), 'de missing key ' + k);
    });
    t('i18n: pt UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('pt').includes(k), 'pt missing key ' + k);
    });
    t('i18n: es UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('es').includes(k), 'es missing key ' + k);
    });
    t('i18n: sv UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('sv').includes(k), 'sv missing key ' + k);
    });
    t('i18n: fi UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('fi').includes(k), 'fi missing key ' + k);
    });
    t('i18n: fr UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('fr').includes(k), 'fr missing key ' + k);
    });
    t('i18n: it UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('it').includes(k), 'it missing key ' + k);
    });
    t('i18n: no UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('no').includes(k), 'no missing key ' + k);
    });
    t('i18n: da UI dictionary covers every en key', () => {
      for (const k of I18N.keys('en'))
        assert(I18N.keys('da').includes(k), 'da missing key ' + k);
    });
    t('i18n: inline per-language fields override overlay files', () => {
      const base = ENTRIES.find(e => e.id === 'sumer_writing');
      const fake = Object.assign({}, base, { name_uk: 'Тест назви', d_de: 'Testbeschreibung' });
      const prev = I18N.lang;
      try {
        I18N.setLang('uk', false);
        assert(I18N.entryName(fake) === 'Тест назви', 'inline name_uk wins over DATA_UK');
        assert(I18N.entryName(base) === DATA_UK[base.id].n, 'overlay name still used without inline');
        I18N.setLang('de', false);
        assert(I18N.entryDesc(fake) === 'Testbeschreibung', 'inline d_de wins over DATA_DE');
        assert(I18N.entryName(fake) === DATA_DE[base.id].n, 'overlay name used when no inline field');
      } finally {
        I18N.setLang(prev, false);
      }
    });
    t('i18n: visibleInLang — default all, langs restricts, [] = draft', () => {
      const e = ENTRIES.find(x => x.id === 'sumer_writing');
      for (const l of I18N.langMeta.map(m => m.code))
        assert(I18N.visibleInLang(e, l), 'base entry must be visible in ' + l);
      const restricted = Object.assign({}, e, { langs: ['uk', 'en'] });
      assert(I18N.visibleInLang(restricted, 'uk') && I18N.visibleInLang(restricted, 'en'),
        'listed languages visible');
      assert(!I18N.visibleInLang(restricted, 'de'), 'unlisted language hidden');
      const draft = Object.assign({}, e, { langs: [] });
      assert(!I18N.visibleInLang(draft, 'uk'), 'empty langs = draft pin hidden everywhere');
    });
    t('i18n: every tour step and city has a uk label', () => {
      for (const tr of TOURS) {
        assert(tr.name_uk && tr.desc_uk, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_uk, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_UK || CITY_UK[nm], 'city missing uk label: ' + nm);
    });
    t('i18n: every tour step and city has a de label', () => {
      for (const tr of TOURS) {
        assert(tr.name_de && tr.desc_de, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_de, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_DE || CITY_DE[nm], 'city missing de label: ' + nm);
    });
    t('i18n: every tour step and city has a pt label', () => {
      for (const tr of TOURS) {
        assert(tr.name_pt && tr.desc_pt, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_pt, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_PT || CITY_PT[nm], 'city missing pt label: ' + nm);
    });
    t('i18n: every tour step and city has an es label', () => {
      for (const tr of TOURS) {
        assert(tr.name_es && tr.desc_es, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_es, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_ES || CITY_ES[nm], 'city missing es label: ' + nm);
    });
    t('i18n: every tour step and city has an sv label', () => {
      for (const tr of TOURS) {
        assert(tr.name_sv && tr.desc_sv, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_sv, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_SV || CITY_SV[nm], 'city missing sv label: ' + nm);
    });
    t('i18n: every tour step and city has an fi label', () => {
      for (const tr of TOURS) {
        assert(tr.name_fi && tr.desc_fi, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_fi, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_FI || CITY_FI[nm], 'city missing fi label: ' + nm);
    });
    t('i18n: every tour step and city has an fr label', () => {
      for (const tr of TOURS) {
        assert(tr.name_fr && tr.desc_fr, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_fr, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_FR || CITY_FR[nm], 'city missing fr label: ' + nm);
    });
    t('i18n: every tour step and city has an it label', () => {
      for (const tr of TOURS) {
        assert(tr.name_it && tr.desc_it, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_it, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_IT || CITY_IT[nm], 'city missing it label: ' + nm);
    });
    t('i18n: every tour step and city has a no label', () => {
      for (const tr of TOURS) {
        assert(tr.name_no && tr.desc_no, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_no, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_NO || CITY_NO[nm], 'city missing no label: ' + nm);
    });
    t('i18n: every tour step and city has a da label', () => {
      for (const tr of TOURS) {
        assert(tr.name_da && tr.desc_da, tr.id + ' tour name/desc');
        for (const s of tr.steps) assert(s.note_da, tr.id + ' step note');
      }
      for (const [, , , names] of CITIES)
        for (const [, nm] of names)
          assert(!window.CITY_DA || CITY_DA[nm], 'city missing da label: ' + nm);
    });
    t('timeline: window clamped to bounds', () => {
      const tl = window.__atlas.timeline;
      tl.setWindow(-99999, 100);
      assert(tl.center > tl.minYear - 200, 'center clamped low');
      tl.setWindow(99999, 100);
      assert(tl.center < tl.maxYear + 200, 'center clamped high');
      tl.setWindow(1500, 100);
    });
    t('timeline: view zoom clamps and keeps its anchor', () => {
      const tl = window.__atlas.timeline;
      tl.setViewRange(tl.minYear, tl.maxYear);
      const t0 = (1500 - tl.viewStart) / (tl.viewEnd - tl.viewStart);
      tl.zoomView(0.5, 1500);                        // zoom in ×2 around 1500
      approx(tl.viewEnd - tl.viewStart, (tl.maxYear - tl.minYear) / 2, 1, 'span halved');
      approx((1500 - tl.viewStart) / (tl.viewEnd - tl.viewStart), t0, 0.001, 'anchor kept');
      tl.zoomView(1e9, 1500);                        // zoom way out → full view
      approx(tl.viewStart, tl.minYear, 0.001, 'full view low edge');
      approx(tl.viewEnd, tl.maxYear, 0.001, 'full view high edge');
      tl.setViewRange(tl.minYear, tl.maxYear);
    });
    t('timeline: window changes keep the view containing the window', () => {
      const tl = window.__atlas.timeline;
      tl.setViewRange(1200, 1400);                   // narrow zoomed view
      tl.setWindow(1500, 100);                       // window right of the view
      assert(tl.viewStart <= tl.winStart + 0.01 && tl.viewEnd >= tl.winEnd - 0.01,
        'view must contain the window after a jump');
      assert(tl.viewEnd - tl.viewStart >= 100, 'view at least window-wide');
      tl.setViewRange(tl.minYear, tl.maxYear);
      tl.setWindow(1500, 100);
    });
    t('timeline: ruler step adapts to the zoomed span', () => {
      const tl = window.__atlas.timeline;
      const sFull = tl._tickStep(tl.maxYear - tl.minYear);
      const sMid = tl._tickStep(300);
      const sDeep = tl._tickStep(30);
      assert(sFull > sMid && sMid > sDeep, 'step must grow with span: ' + sFull + '/' + sMid + '/' + sDeep);
      assert(sDeep <= 5, 'a 30-year view gets fine ticks, got ' + sDeep);
    });

    /* ── map behaviour ──────────────────────────────────────────── */
    t('map: dynamic zoom floor holds', () => {
      const m = window.__atlas.map;
      assert(m._minZoom() > 0, 'floor must be positive on a sized viewport');
      m.zoomBy(-9);
      approx(m.zoom, m._minZoom(), 0.001, 'zoom pins to floor');
      assert(m.worldSize() >= Math.min(m.container.clientWidth, m.container.clientHeight) - 1,
        'world never smaller than the smaller viewport side');
    });

    /* ── app behaviour (async) ──────────────────────────────────── */
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(250);

    t('app: markers render for a populated window', () => {
      const A = window.__atlas;
      A.timeline.setWindow(1500, 100);
      assert(document.querySelectorAll('.marker.on').length > 10, 'expected many markers at 1500');
    });
    t('app: clustering collapses stacks at low zoom', () => {
      const A = window.__atlas;
      A.map.setView(0.55, 0.42, Math.max(A.map._minZoom(), 1.4), false);
      A.onTimeChange(true);
      const clusters = document.querySelectorAll('.cluster').length;
      assert(clusters > 0, 'expected clusters at low zoom (Kyiv alone stacks 16 pins)');
      A.map.zoomBy(4);                       // drill above the cluster threshold
      A.onTimeChange(true);
      assert(document.querySelectorAll('.cluster').length === 0, 'no clusters above threshold');
    });
    t('app: Kyiv pile exists above cluster zoom', () => {
      const A = window.__atlas;
      A.timeline.setWindow(1000, 120);
      const n = PROJ.fromLatLon(50.45, 30.52);
      A.map.setView(n.nx, n.ny, 5.6, false);
      A.onTimeChange(true);
      const pile = [...A.S.markerEls.entries()].filter(([, el]) => {
        const e = ENTRIES.find(x => x.id === el.dataset.id);
        return e && Math.abs(e.lat - 50.45) < 0.03 && Math.abs(e.lon - 30.52) < 0.03;
      });
      assert(pile.length >= 3, 'expected a Kyiv pile at year 1000, got ' + pile.length);
      A._testPile = pile;
    });
    await wait(150);                          // markers fade in on next rAF ('on' class)

    t('app: hovering a pile fans every pin out', () => {
      const A = window.__atlas;
      const [, el] = A._testPile[0];
      el.dispatchEvent(new MouseEvent('mouseenter'));
      const fans = document.querySelectorAll('.marker.fan');
      assert(fans.length === A._testPile.length,
        'fanned ' + fans.length + ' of ' + A._testPile.length + ' pile pins');
      const poses = new Set([...fans].map(m => m.style.transform));
      assert(poses.size === fans.length, 'fan positions must be pairwise distinct');
      const off = (el.style.transform.match(/-?[\d.]+px/g) || []).map(v => parseFloat(v));
      assert(off.length === 2 && off.every(v => v === 0),
        'hovered pin keeps its true position — got "' + el.style.transform +
        '" id=' + el.dataset.id + ' connected=' + el.isConnected);
      // hovering a sibling keeps the same fan open (no refold/flicker)
      A._testPile[1][1].dispatchEvent(new MouseEvent('mouseenter'));
      assert(A.S.fan && A.S.fan.ids.size === A._testPile.length, 'fan survives pin-to-pin move');
      A._testPile[0][1].dispatchEvent(new MouseEvent('mouseleave'));
    });
    await wait(450);                          // FAN_CLOSE_MS fold-back delay

    t('app: fan folds back after the pointer leaves', () => {
      assert(document.querySelectorAll('.marker.fan').length === 0, 'fan should be folded');
      assert(window.__atlas.S.fan === null, 'fan state cleared');
      window.__atlas.timeline.setWindow(1500, 100);
    });
    t('app: contemporaries mode filters to overlapping figures', () => {
      const A = window.__atlas;
      const anchor = ENTRIES.find(e => e.id === 'leonardo');
      A.timeline.setWindow(1500, 100);
      A.selectEntry(anchor, false);
      document.querySelector('.pp-ctmp').click();
      const shown = [...A.S.markerEls.keys()];
      const expected = ENTRIES.filter(e => e.t === 'p' && e.y0 <= anchor.y1 && e.y1 >= anchor.y0);
      assert(shown.length === expected.length,
        'shown ' + shown.length + ' vs expected ' + expected.length);
      assert(expected.some(e => e.id === 'michelangelo'), 'sanity: Michelangelo expected');
      document.querySelector('.pp-ctmp').click();   // exit
      assert(A.S.contemp === null, 'mode exited');
    });
    t('app: pin with langs=["uk"] hidden in en, shown in uk', () => {
      const A = window.__atlas;
      const prev = I18N.lang;
      const probe = {
        id: 'selftest_probe', t: 'e', cat: 'culture', y0: 1500, y1: 1500,
        lat: 10, lon: 10, place: 'Testplace', name: 'Selftest probe',
        d: 'selftest probe pin', langs: ['uk'], name_uk: 'Тестовий пін'
      };
      try {
        ENTRIES.push(probe);
        HIST_DATA.rev = (HIST_DATA.rev || 0) + 1;
        I18N.setLang('en', false);
        A.timeline.setWindow(1500, 100);
        A.onTimeChange(true);
        assert(!A.S.markerEls.has('selftest_probe'), 'probe must be hidden in en');
        I18N.setLang('uk', false);           // langchange rebuilds markers
        assert(A.S.markerEls.has('selftest_probe'), 'probe must be visible in uk');
        I18N.setLang('en', false);
        assert(!A.S.markerEls.has('selftest_probe'), 'probe hidden again after switching back');
      } finally {
        const i = ENTRIES.indexOf(probe);
        if (i !== -1) ENTRIES.splice(i, 1);
        HIST_DATA.rev = (HIST_DATA.rev || 0) + 1;
        I18N.setLang(prev, false);
        A.timeline.setWindow(1500, 100);
        A.onTimeChange(true);
      }
    });
    t('app: search dropdown offers all-time jumps', () => {
      const inp = document.getElementById('search');
      inp.value = 'Mansa Musa';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const items = document.querySelectorAll('#searchDrop .sd-item');
      assert(items.length > 0, 'dropdown has matches');
      const first = document.querySelector('#searchDrop .sd-item');
      first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      const A = window.__atlas;
      approx(A.timeline.center, 1312, 60, 'jumped near Mansa Musa era');
      assert(inp.value === '', 'search cleared after jump');
      assert(document.querySelectorAll('.marker.sel').length === 1, 'entry selected');
    });
    t('overlay: travel paths diffed, not rebuilt per tick', () => {
      const A = window.__atlas;
      A.timeline.setWindow(1330, 100);
      const el1 = document.querySelector('.ol-path');
      assert(el1, 'paths present at 1330');
      A.timeline.setWindow(1360, 100);
      A.timeline.setWindow(1340, 100);
      assert(document.querySelector('.ol-path') === el1, 'same element reused across ticks');
      A.timeline.setWindow(2000, 30);
      assert(document.querySelectorAll('.ol-path').length === 0, 'removed when out of window');
      A.timeline.setWindow(1500, 100);
    });
    t('overlay: territories disabled (SHOW_TERRITORIES=false)', () => {
      assert(document.querySelectorAll('.ol-terr').length === 0, 'no polygons expected');
    });
    t('ui: from–to fields select an exact period', () => {
      const A = window.__atlas;
      const f = document.getElementById('yearFrom'), to = document.getElementById('yearTo');
      f.value = '-44'; to.value = '30';
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      approx(A.timeline.center, -7, 2, 'window centred on 44 BC–30 AD');
      approx(A.timeline.width, 75, 2, 'window spans the typed years');
      f.value = ''; to.value = '';
      A.timeline._viewAnim = null;
      A.timeline.setWindow(1500, 100);
      A.timeline.setViewRange(A.timeline.minYear, A.timeline.maxYear);
    });
    document.getElementById('periodSel').value = 'middle';
    document.getElementById('periodSel').dispatchEvent(new Event('change'));
    {                                       // the view zoom animates via rAF — wait by state, not by clock
      const A = window.__atlas;
      for (let i = 0; i < 30 && (A.timeline.viewEnd - A.timeline.viewStart) > 2000; i++)
        await wait(100);
    }
    t('ui: Period menu applies the era and zooms the view', () => {
      const A = window.__atlas;
      const sel = document.getElementById('periodSel');
      assert(sel.options.length === 9, 'placeholder + all + 7 eras, got ' + sel.options.length);
      approx(A.timeline.center, 975, 2, 'window centred on the Middle Ages');
      approx(A.timeline.width, 951, 2, 'era span becomes the window');
      assert(A.timeline.viewEnd - A.timeline.viewStart < 2000, 'view zoomed to the era');
      assert(sel.selectedIndex === 0, 'menu reset to its placeholder');
      A.timeline.setWindow(1500, 100);
      A.timeline.setViewRange(A.timeline.minYear, A.timeline.maxYear);
    });
    t('editor: pristine snapshot matches dataset size', () => {
      // no overrides in this session → reset state equals shipped data
      const ls = JSON.parse(localStorage.getItem('histmap.overrides') || '{"up":{},"del":[]}');
      assert(Object.keys(ls.up || {}).length === 0 && (ls.del || []).length === 0,
        'overrides present — run selftest with a clean profile');
    });
    t('runtime: zero uncaught errors this session', () => {
      const errs = window.__errs || [];
      assert(errs.length === 0, errs.slice(0, 3).join(' | '));
    });

    /* ── tags ───────────────────────────────────────────────────── */
    t('tags: registry valid, labels in all 11 languages', () => {
      const { TAGS, TAG_GROUPS } = HIST_DATA;
      const langs = I18N.langMeta.map(m => m.code);
      for (const [k, tg] of Object.entries(TAGS)) {
        assert(TAG_GROUPS[tg.group], k + ': bad group "' + tg.group + '"');
        for (const l of langs) {
          const v = l === 'en' ? tg.label : tg['label_' + l];   // en lives in the bare `label`, like CATS
          assert(typeof v === 'string' && v.length > 0, 'tag ' + k + ' missing label_' + l);
        }
      }
      for (const [k, g] of Object.entries(TAG_GROUPS))
        for (const l of langs) {
          const v = l === 'en' ? g.label : g['label_' + l];
          assert(typeof v === 'string' && v.length > 0, 'group ' + k + ' missing label_' + l);
        }
    });
    t('tags: entries reference registry keys, batches covered', () => {
      const c = (k) => ENTRIES.filter(e => (e.tags || []).includes(k)).length;
      assert(c('ww2') >= 80, 'ww2 >= 80, got ' + c('ww2'));
      assert(c('napoleonic') >= 55, 'napoleonic >= 55, got ' + c('napoleonic'));
      assert(c('ww1') >= 70, 'ww1 >= 70, got ' + c('ww1'));
      assert(c('alexander') >= 9, 'alexander >= 9, got ' + c('alexander'));
      assert(c('battle') >= 100, 'battle >= 100, got ' + c('battle'));
      for (const e of ENTRIES)
        for (const k of (e.tags || []))
          assert(HIST_DATA.TAGS[k], e.id + ': unknown tag "' + k + '"');
      const toulon = ENTRIES.find(e => e.id === 'nb_toulon');
      assert(toulon && toulon.tags.includes('siege') && toulon.tags.includes('napoleonic'),
        'nb_toulon must carry siege + napoleonic');
    });
    t('ui: tag chips render in both facet rows', () => {
      const kind = document.querySelectorAll('#chips .gchip').length;
      const ev = document.querySelectorAll('#chips .echip').length;
      assert(kind === 10, '10 kind chips, got ' + kind);
      assert(ev === 11, '11 event chips, got ' + ev);
      assert(document.querySelectorAll('#chips .tagrow-l').length === 2, 'two facet row labels');
    });
    t('app: tag chips filter markers facet-wise (OR in row, AND across)', () => {
      const A = window.__atlas;
      A.timeline.setWindow(1793, 20);        // Napoleon's rise — Toulon 1793 … Austerlitz 1805
      A.onTimeChange(true);
      const before = A.S.markerEls.size;
      assert(before > 5, 'markers expected around 1805, got ' + before);
      const evChip = [...document.querySelectorAll('#chips .echip')]
        .find(c => c.dataset.k === 'tag:ev:napoleonic');
      assert(evChip, 'napoleonic chip present');
      evChip.click();
      assert(evChip.classList.contains('on'), 'chip toggled on');
      const napo = [...A.S.markerEls.keys()];
      assert(napo.length > 0 && napo.length < before, 'napoleonic filter narrowed ' + before + ' → ' + napo.length);
      assert(napo.every(id => (ENTRIES.find(e => e.id === id).tags || []).includes('napoleonic')),
        'every shown pin carries the tag');
      const kindChip = [...document.querySelectorAll('#chips .gchip')]
        .find(c => c.dataset.k === 'tag:kind:siege');
      kindChip.click();
      const sieges = [...A.S.markerEls.keys()];
      assert(sieges.length > 0 && sieges.length < napo.length, 'siege facet narrowed further');
      assert(sieges.every(id => {
        const tg = ENTRIES.find(e => e.id === id).tags || [];
        return tg.includes('napoleonic') && tg.includes('siege');
      }), 'facets AND-combined across rows');
      document.querySelector('#chips .allchip').click();
      assert(A.S.markerEls.size === before, 'reset restores the unfiltered window');
      A.timeline.setWindow(1500, 100);
    });
    t('app: popup shows tag badges for the selected pin', () => {
      const A = window.__atlas;
      const prev = I18N.lang;
      try {
        I18N.setLang('en', false);
        A.timeline.setWindow(1793, 4);
        A.selectEntry(ENTRIES.find(e => e.id === 'nb_toulon'), false);
        const tags = [...document.querySelectorAll('#popup .pp-tag')].map(x => x.textContent.trim());
        assert(tags.some(x => x.toLowerCase().includes('napoleonic')), 'napoleonic badge, got: ' + tags.join(' | '));
        assert(tags.some(x => x.toLowerCase().includes('siege')), 'siege badge, got: ' + tags.join(' | '));
        document.querySelector('#popup .pp-x').click();
      } finally {
        I18N.setLang(prev, false);
      }
      A.timeline.setWindow(1500, 100);
    });
    t('ui: tag chips relocalize on language switch', () => {
      const prev = I18N.lang;
      try {
        I18N.setLang('uk', false);
        const bitva = [...document.querySelectorAll('#chips .gchip')]
          .find(c => c.dataset.k === 'tag:kind:battle');
        assert(bitva && bitva.textContent.includes('Битва'), 'battle chip localized to uk');
        const ww2 = [...document.querySelectorAll('#chips .echip')]
          .find(c => c.dataset.k === 'tag:ev:ww2');
        assert(ww2 && ww2.textContent.includes('Друга світова війна'), 'ww2 chip localized to uk');
      } finally {
        I18N.setLang(prev, false);
      }
    });

    /* ── report ─────────────────────────────────────────────────── */
    const fails = results.filter(r => r[0] === 'FAIL');
    const box = document.createElement('pre');
    box.id = 'selftestBox';
    box.textContent = results.map(([s, n, m]) =>
      (s === 'PASS' ? '  ✓ ' : '  ✗ ') + n + (m ? '\n      → ' + m : '')).join('\n') +
      '\n\n' + (fails.length ? fails.length + ' FAILURE(S)' : 'ALL ' + results.length + ' TESTS PASSED');
    document.body.appendChild(box);
    document.title = 'SELFTEST ' + (fails.length ? 'FAIL (' + fails.length + ')' : 'OK');
    console.log('%c' + box.textContent,
      'color:' + (fails.length ? '#ff8080' : '#7ed957'));
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', run);
  else run();
})();
