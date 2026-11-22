/* ── editor.js — built-in marker editor (password-gated) ─────────
 * Add / edit / delete events & figures directly in the app.
 * Multilanguage: text fields are per-language tabs (EN base + one per
 * DATA_* overlay language). Non-empty tab text is saved as inline
 * fields on the entry (name_uk, d_de, …) which override the overlay
 * files; empty fields fall back (overlay → English base). A "Show in
 * languages" checkbox row restricts an entry to a subset of UI
 * languages via entry.langs — omitted = all, [] = hidden everywhere
 * (a draft pin).
 * Persistence:
 *   - POST /api/save → data_overrides.json on disk (serve.ps1 supports it);
 *   - always mirrored to localStorage, so it also works under any server;
 *   - "Export data.js" bakes the full merged dataset into a drop-in file.
 * Gate: client-side password (deterrent, not real security — it's a
 * static app). Default "atlas", changeable in-app (stored hashed).
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const DEFAULT_PW = 'atlas';
  const LS_OVR = 'histmap.overrides';
  const LS_PW = 'histmap.pw';
  const SS_UNLOCK = 'histmap.editorUnlocked';

  const ALL_LANGS = I18N.langMeta.map(l => l.code);
  const TEXT_LANGS = ALL_LANGS.filter(c => c !== 'en');
  let langDraft = null;     // per-tab text drafts: { en: {name,place,d,src}, uk: … }
  let tabLang = 'en';       // editor tab currently shown
  const A = () => window.__atlas;
  const E = () => HIST_DATA.ENTRIES;
  let pristine = [];        // snapshot before overrides
  let overrides = { up: {}, del: [] };
  let editing = null;       // entry currently in the form
  let pickMode = false;
  let serverMode = null;    // null unknown | true | false

  /* ── password ─────────────────────────────────────────────── */

  async function sha256(s) {
    if (window.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    return 'plain:' + s;   // non-secure context fallback
  }

  async function checkPassword(pw) {
    const custom = localStorage.getItem(LS_PW);
    if (custom) return (await sha256(pw)) === custom;
    return pw === DEFAULT_PW;
  }

  /* ── overrides model ──────────────────────────────────────── */

  function snapshotOriginals() {
    pristine = E().map(e => ({ ...e, path: e.path ? e.path.slice() : undefined }));
  }

  function applyOverrides() {
    for (const id of overrides.del) {
      const i = E().findIndex(e => e.id === id);
      if (i !== -1) E().splice(i, 1);
    }
    for (const id of Object.keys(overrides.up)) {
      const e = overrides.up[id];
      const i = E().findIndex(x => x.id === id);
      if (i !== -1) E()[i] = e; else E().push(e);
    }
    HIST_DATA.rev = (HIST_DATA.rev || 0) + 1;   // invalidates timeline's sort cache
    refreshAll();
  }

  function refreshAll() {
    if (!A()) return;
    A().onTimeChange(true);
    A().timeline.draw();
  }

  function persist() {
    localStorage.setItem(LS_OVR, JSON.stringify(overrides));
    return fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides)
    }).then(r => { serverMode = r.ok; updateStatus(); return r.ok; })
      .catch(() => { serverMode = false; updateStatus(); return false; });
  }

  function updateStatus() {
    const el = document.getElementById('edStatus');
    if (!el) return;
    const n = Object.keys(overrides.up).length + overrides.del.length;
    el.textContent =
      (serverMode === true ? I18N.t('edStatusServer') :
       serverMode === false ? I18N.t('edStatusLocal') :
       I18N.t('edStatusUnknown')) +
      ' · ' + n + ' ' + I18N.plural(n, 'change', 'changes', 'changes');
    el.className = serverMode === false ? 'ed-status warn' : 'ed-status';
  }

  /* ── editor DOM ────────────────────────────────────────────── */

  function build() {
    if (document.getElementById('editorOverlay')) return;
    const t = I18N.t;
    const ov = document.createElement('div');
    ov.id = 'editorOverlay';
    ov.innerHTML = `
      <div id="editorBox">
        <div class="ed-head">
          <b>${t('edTitle')}</b>
          <span id="edStatus" class="ed-status"></span>
          <button id="edClose" class="pp-x" title="${t('closeEscTitle')}">×</button>
        </div>
        <div class="ed-body">
          <div class="ed-form">
            <div class="ed-row">
              <label>${t('edType')}
                <select id="edType"><option value="e">${t('edTypeEvent')}</option><option value="p">${t('edTypeFigure')}</option></select>
              </label>
              <label>${t('edCat')}
                <select id="edCat"></select>
              </label>
            </div>
            <div class="ed-tags-row"><span class="ed-taglbl">${t('edTags')}</span><div class="ed-tags" id="edTags"></div></div>
            <div class="ed-tabs" id="edTabs"></div>
            <small class="ed-hint" id="edHint"></small>
            <label>${t('edNameLbl')}<input id="edName" placeholder="${t('edPhName')}" /></label>
            <label>${t('edPlaceLbl')}<input id="edPlace" placeholder="${t('edPhPlace')}" /></label>
            <div class="ed-row">
              <label>${t('edY0')}<input id="edY0" placeholder="${t('edPhY0')}" /></label>
              <label>${t('edY1')}<input id="edY1" placeholder="${t('edPhY1')}" /></label>
              <label class="ed-chk"><input type="checkbox" id="edOngoing" /> ${t('edOngoing')}</label>
            </div>
            <div class="ed-row">
              <label>${t('edLat')}<input id="edLat" placeholder="${t('edPhLat')}" /></label>
              <label>${t('edLon')}<input id="edLon" placeholder="${t('edPhLon')}" /></label>
              <button id="edPick" type="button">${t('edPick')}</button>
            </div>
            <label>${t('edDesc')}<textarea id="edDesc" rows="3" placeholder="${t('edPhDesc')}"></textarea></label>
            <label>${t('edSrc')}<input id="edSrc" placeholder="${t('edPhSrc')}" /></label>
            <div class="ed-langrow" id="edLangs"></div>
            <label>${t('edPath')}<textarea id="edPath" rows="2"></textarea></label>
          </div>
          <div class="ed-side">
            <b class="ed-side-title">${t('edEditExisting')}</b>
            <input id="edSearch" placeholder="${t('edPhSearch')}" />
            <div id="edResults"></div>
            <div class="ed-actions">
              <button id="edSave" class="primary">${t('edSave')}</button>
              <button id="edNew">${t('edNew')}</button>
              <button id="edDelete" class="danger">${t('edDelete')}</button>
            </div>
            <div class="ed-actions">
              <button id="edExport">${t('edExport')}</button>
              <button id="edImport">${t('edImport')}</button>
              <button id="edReset" class="danger">${t('edReset')}</button>
            </div>
            <div class="ed-actions">
              <button id="edPw">${t('edPw')}</button>
            </div>
            <input type="file" id="edFile" accept=".json" style="display:none" />
          </div>
        </div>
      </div>
      <div id="pickBanner" hidden>${t('pickBanner')}</div>`;
    document.body.appendChild(ov);
    ov.querySelector('#edPath').placeholder = t('edPhPath');   // multi-line → set via JS

    const catSel = ov.querySelector('#edCat');
    catSel.innerHTML = Object.entries(HIST_DATA.CATS)
      .map(([k, c]) => `<option value="${k}">${c.icon} ${I18N.catLabel(c)}</option>`).join('');
    ov.querySelector('#edTags').innerHTML = Object.entries(HIST_DATA.TAGS)
      .map(([k, tg]) =>
        `<label class="ed-tagchk" title="${esc(I18N.catLabel(tg))}">` +
        `<input type="checkbox" data-tag="${k}" /> ${tg.icon} ${esc(I18N.catLabel(tg))}</label>`).join('');
    buildTabs(ov);

    ov.querySelector('#edClose').onclick = closeEditor;
    ov.querySelector('#edSave').onclick = saveForm;
    ov.querySelector('#edNew').onclick = () => loadForm(null);
    ov.querySelector('#edDelete').onclick = deleteCurrent;
    ov.querySelector('#edExport').onclick = exportDataJs;
    ov.querySelector('#edImport').onclick = () => ov.querySelector('#edFile').click();
    ov.querySelector('#edFile').onchange = importJson;
    ov.querySelector('#edReset').onclick = resetAll;
    ov.querySelector('#edPw').onclick = changePassword;
    ov.querySelector('#edPick').onclick = startPick;
    ov.querySelector('#edSearch').oninput = renderSearch;

    // intercept marker clicks while editing
    document.addEventListener('click', (ev) => {
      if (!ov.classList.contains('open') || pickMode) return;
      const m = ev.target.closest && ev.target.closest('.marker');
      if (!m) return;
      const en = E().find(x => x.id === m.dataset.id);
      if (en) { ev.stopPropagation(); ev.preventDefault(); loadForm(en); }
    }, true);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        const pm = document.getElementById('pwModal');
        if (pm && pm.style.display === 'grid') { pm.style.display = 'none'; return; }
        if (pickMode) { stopPick(); }
        else if (ov.classList.contains('open')) { closeEditor(); }
      }
      if (ev.ctrlKey && ev.shiftKey && (ev.key === 'E' || ev.key === 'e')) {
        ev.preventDefault(); openEditor();
      }
    });
  }

  function openEditor() {
    build();
    const ov = document.getElementById('editorOverlay');
    if (sessionStorage.getItem(SS_UNLOCK)) { show(ov); return; }

    let pm = document.getElementById('pwModal');
    if (!pm) {
      pm = document.createElement('div');
      pm.id = 'pwModal';
      pm.innerHTML = `<div class="pw-card">
          <b>${I18N.t('pwTitle')}</b>
          <input id="pwInput" type="password" placeholder="${I18N.t('pwPh')}" autocomplete="off" />
          <div class="pw-row">
            <button id="pwOk">${I18N.t('pwUnlock')}</button>
            <button id="pwCancel">${I18N.t('pwCancel')}</button>
          </div>
          <small id="pwHint">&nbsp;</small>
        </div>`;
      document.body.appendChild(pm);
      pm.addEventListener('click', (ev) => { if (ev.target === pm) pm.style.display = 'none'; });
      pm.querySelector('#pwCancel').onclick = () => { pm.style.display = 'none'; };
      pm.querySelector('#pwOk').onclick = () => tryUnlock(pm);
      pm.querySelector('#pwInput').onkeydown = (ev) => { if (ev.key === 'Enter') tryUnlock(pm); };
    }
    pm.style.display = 'grid';
    const inp = pm.querySelector('#pwInput');
    inp.value = '';
    pm.querySelector('#pwHint').innerHTML = '&nbsp;';
    inp.focus();
  }

  async function tryUnlock(pm) {
    const pw = pm.querySelector('#pwInput').value;
    if (await checkPassword(pw)) {
      sessionStorage.setItem(SS_UNLOCK, '1');
      pm.style.display = 'none';
      show(document.getElementById('editorOverlay'));
    } else {
      pm.querySelector('#pwHint').textContent = I18N.t('pwWrong');
      pm.querySelector('#pwInput').select();
    }
  }

  function show(ov) {
    ov.classList.add('open');
    loadForm(null);
    renderSearch();
    persist();   // probe server mode + write mirror
  }

  function closeEditor() {
    stopPick();
    document.getElementById('editorOverlay').classList.remove('open');
  }

  /* ── pick-on-map ───────────────────────────────────────────── */

  let pickCleanup = null;

  function startPick() {
    pickMode = true;
    document.getElementById('editorOverlay').classList.remove('open');
    const b = document.getElementById('pickBanner');
    b.hidden = false;
    let downXY = null;
    const mapEl = document.getElementById('map');
    const onDown = (ev) => { downXY = [ev.clientX, ev.clientY]; };
    const onClick = (ev) => {
      if (!pickMode) return;                     // Esc already ended pick mode
      if (!downXY || Math.hypot(ev.clientX - downXY[0], ev.clientY - downXY[1]) > 5) return;
      const r = mapEl.getBoundingClientRect();
      const n = A().map.screenToNorm(ev.clientX - r.left, ev.clientY - r.top);
      const ll = PROJ.toLatLon(n.nx, n.ny);
      document.getElementById('edLat').value = ll.lat.toFixed(4);
      document.getElementById('edLon').value = ll.lon.toFixed(4);
      cleanup();
      toast(I18N.t('edPosSet', { pos: ll.lat.toFixed(3) + ', ' + ll.lon.toFixed(3) }));
      document.getElementById('editorOverlay').classList.add('open');
    };
    const cleanup = () => {
      pickMode = false;
      pickCleanup = null;
      b.hidden = true;
      mapEl.removeEventListener('pointerdown', onDown);
      mapEl.removeEventListener('click', onClick, true);
    };
    pickCleanup = cleanup;
    mapEl.addEventListener('pointerdown', onDown);
    mapEl.addEventListener('click', onClick, true);
  }

  function stopPick() {
    if (pickCleanup) pickCleanup();
    pickMode = false;
  }

  /* ── language tabs & per-language drafts ───────────────────── */

  function buildTabs(ov) {
    const box = ov.querySelector('#edTabs');
    box.innerHTML = I18N.langMeta.map(m =>
      `<button type="button" class="ed-tab" data-l="${m.code}" ` +
      `title="${esc(m.code === 'en' ? I18N.t('edTabBase') : m.native)}">${m.short}</button>`).join('');
    box.querySelectorAll('.ed-tab').forEach(b => b.onclick = () => showTab(b.dataset.l));

    const lr = ov.querySelector('#edLangs');
    lr.innerHTML = `<span class="ed-langlbl">${I18N.t('edVisibleIn')}</span>` +
      I18N.langMeta.map(m =>
        `<label class="ed-langchk"><input type="checkbox" data-l="${m.code}" checked /> ${m.short}</label>`).join('');
    lr.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = updateTabs);

    ov.querySelector('#edHint').textContent = I18N.t('edTransHint');
  }

  function readTabInputs() {
    if (!langDraft) return;
    const g = (id) => document.getElementById(id);
    langDraft[tabLang] = {
      name: g('edName').value, place: g('edPlace').value,
      d: g('edDesc').value, src: g('edSrc').value
    };
  }

  function writeTabInputs() {
    const g = (id) => document.getElementById(id);
    const dr = langDraft[tabLang];
    g('edName').value = dr.name; g('edPlace').value = dr.place;
    g('edDesc').value = dr.d;    g('edSrc').value = dr.src;
    updatePlaceholders();
  }

  /* what a translation tab shows as fallback if left empty:
   * the overlay-file translation, else the English base draft */
  function effectiveText(code, key, ovKey) {
    if (code === 'en') return langDraft.en[key];
    const o = editing ? I18N.overlayFor(code, editing.id) : null;
    return (o && o[ovKey]) || langDraft.en[key] || '';
  }

  function updatePlaceholders() {
    const g = (id) => document.getElementById(id);
    if (tabLang === 'en') {
      g('edName').placeholder = I18N.t('edPhName');
      g('edPlace').placeholder = I18N.t('edPhPlace');
      g('edDesc').placeholder = I18N.t('edPhDesc');
      g('edSrc').placeholder = I18N.t('edPhSrc');
      return;
    }
    g('edName').placeholder = effectiveText(tabLang, 'name', 'n') || I18N.t('edPhName');
    g('edPlace').placeholder = effectiveText(tabLang, 'place', 'p') || I18N.t('edPhPlace');
    g('edDesc').placeholder = effectiveText(tabLang, 'd', 'd') || I18N.t('edPhDesc');
    g('edSrc').placeholder = effectiveText(tabLang, 'src', 's') || I18N.t('edPhSrc');
  }

  function showTab(code) {
    readTabInputs();
    tabLang = code;
    writeTabInputs();
    updateTabs();
  }

  function updateTabs() {
    const ov = document.getElementById('editorOverlay');
    if (!ov || !langDraft) return;
    ov.querySelectorAll('.ed-tab').forEach(b => {
      const code = b.dataset.l;
      const cb = ov.querySelector('#edLangs input[data-l="' + code + '"]');
      b.classList.toggle('on', code === tabLang);
      b.classList.toggle('dim', !!cb && !cb.checked);
      b.classList.toggle('has', code !== 'en' &&
        Object.values(langDraft[code]).some(v => v && v.trim()));
    });
  }

  /* ── form ⇄ entry ──────────────────────────────────────────── */

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : NaN; };

  function loadForm(en) {
    editing = en;
    const g = (id) => document.getElementById(id);
    tabLang = 'en';
    langDraft = { en: { name: '', place: '', d: '', src: '' } };
    for (const code of TEXT_LANGS) langDraft[code] = { name: '', place: '', d: '', src: '' };
    if (en) {
      langDraft.en = { name: en.name || '', place: en.place || '', d: en.d || '', src: en.src || '' };
      for (const code of TEXT_LANGS) {
        langDraft[code] = {
          name: en['name_' + code] || '', place: en['place_' + code] || '',
          d: en['d_' + code] || '', src: en['src_' + code] || ''
        };
      }
    }
    g('edType').value = en ? en.t : 'e';
    g('edCat').value = en ? en.cat : 'war';
    document.querySelectorAll('#edTags input[type=checkbox]').forEach(cb =>
      cb.checked = !!(en && (en.tags || []).includes(cb.dataset.tag)));
    g('edY0').value = en ? en.y0 : '';
    g('edY1').value = en && en.y1 !== en.y0 ? en.y1 : '';
    g('edOngoing').checked = !!(en && en.y1 >= 2026);
    g('edLat').value = en ? en.lat : '';
    g('edLon').value = en ? en.lon : '';
    g('edPath').value = en && en.path ? en.path.map(p => p.join(',')).join('\n') : '';
    document.querySelectorAll('#edLangs input[type=checkbox]').forEach(cb => {
      cb.checked = !en || !en.langs || en.langs.includes(cb.dataset.l);
    });
    writeTabInputs();
    updateTabs();
    document.getElementById('edDelete').style.display = en ? '' : 'none';
  }

  function saveForm() {
    readTabInputs();
    const g = (id) => document.getElementById(id).value.trim();
    const nameEn = (langDraft.en.name || '').trim();
    const y0 = num(g('edY0'));
    let y1 = num(g('edY1'));
    const lat = num(g('edLat')), lon = num(g('edLon'));
    const visible = [...document.querySelectorAll('#edLangs input[type=checkbox]')]
      .filter(cb => cb.checked).map(cb => cb.dataset.l);
    const tags = [...document.querySelectorAll('#edTags input[type=checkbox]')]
      .filter(cb => cb.checked).map(cb => cb.dataset.tag);

    if (!ALL_LANGS.some(code =>
        (langDraft[code].name || '').trim() ||
        (editing && I18N.overlayFor(code, editing.id) || {}).n))
      return toast(I18N.t('edNameRequired'));
    if (!isFinite(y0)) return toast(I18N.t('edY0Required'));
    if (document.getElementById('edOngoing').checked) y1 = 2026;
    if (!isFinite(y1)) y1 = y0;
    if (y1 < y0) return toast(I18N.t('edY1Before'));
    if (!isFinite(lat) || !isFinite(lon) || lat < -85 || lat > 85 || lon < -180 || lon > 180)
      return toast(I18N.t('edCoords'));

    let path = null;
    const ptxt = g('edPath');
    if (ptxt) {
      path = ptxt.split(/[\n;]+/).map(s => s.trim()).filter(Boolean).map(s => s.split(',').map(Number));
      if (path.some(p => p.length !== 2 || !p.every(isFinite))) return toast(I18N.t('edPathBad'));
    }

    /* every language the pin is shown in needs a name: its own text,
     * the overlay-file translation (existing entries), or the EN base */
    const missing = visible.filter(code => !(
      (langDraft[code].name || '').trim() ||
      (editing && I18N.overlayFor(code, editing.id) || {}).n ||
      nameEn));
    if (missing.length)
      return toast(I18N.t('edMissingName', { langs: missing.join(', ') }));

    const slugSrc = nameEn || ALL_LANGS.map(c => (langDraft[c].name || '').trim()).find(Boolean) || '';
    const slug = slugSrc.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const id = editing ? editing.id : (slug || 'pin') + '_' + Math.random().toString(36).slice(2, 6);

    const en = {
      id, t: document.getElementById('edType').value,
      cat: document.getElementById('edCat').value,
      name: nameEn, y0, y1, lat, lon,
      place: (langDraft.en.place || '').trim() || '—',
      d: (langDraft.en.d || '').trim() || '(no description yet)',
      src: (langDraft.en.src || '').trim() || undefined
    };
    for (const code of TEXT_LANGS) {
      const dr = langDraft[code];
      if (dr.name.trim()) en['name_' + code] = dr.name.trim();
      if (dr.place.trim()) en['place_' + code] = dr.place.trim();
      if (dr.d.trim()) en['d_' + code] = dr.d.trim();
      if (dr.src.trim()) en['src_' + code] = dr.src.trim();
    }
    if (visible.length < ALL_LANGS.length) en.langs = visible;   // [] = hidden draft
    if (tags.length) en.tags = tags;
    if (path) en.path = path;

    overrides.up[id] = en;
    const di = overrides.del.indexOf(id);
    if (di !== -1) overrides.del.splice(di, 1);
    applyOverrides();
    persist();
    loadForm(en);
    renderSearch();
    const displayName = nameEn || TEXT_LANGS.map(c => en['name_' + c]).find(Boolean) || id;
    toast(I18N.t('edSaved', { name: displayName }));
  }

  function deleteCurrent() {
    if (!editing) return;
    const en = editing;
    if (!confirm(I18N.t('edConfirmDel', { name: en.name }))) return;
    delete overrides.up[en.id];
    // only tombstone ids that exist in the base dataset — entries created
    // here never existed there, a del record would be dead weight forever
    if (pristine.some(p => p.id === en.id)) overrides.del.push(en.id);
    else overrides.del = overrides.del.filter(id => id !== en.id);
    applyOverrides();
    persist();
    loadForm(null);
    toast(I18N.t('edDeleted', { name: en.name }));
  }

  function resetAll() {
    if (!confirm(I18N.t('edConfirmReset'))) return;
    overrides = { up: {}, del: [] };
    E().length = 0;
    E().push(...pristine.map(e => ({ ...e })));
    persist();
    refreshAll();
    loadForm(null);
    renderSearch();
    toast(I18N.t('edResetDone'));
  }

  /* ── search existing ───────────────────────────────────────── */

  function renderSearch() {
    const q = document.getElementById('edSearch').value.trim().toLowerCase();
    const box = document.getElementById('edResults');
    if (!q) { box.innerHTML = `<div class="ed-empty">${I18N.t('edTypeToSearch')}</div>`; return; }
    /* search across every language's name — pins hidden in the current
     * UI language must stay findable here so they can be edited */
    const hits = E().filter(e => {
      const hay = [e.name, I18N.entryName(e), e.place || '']
        .concat(TEXT_LANGS.map(c => e['name_' + c] || '')).join(' ').toLowerCase();
      return hay.includes(q);
    }).slice(0, 14);
    const curMeta = I18N.langMeta.find(m => m.code === I18N.lang);
    box.innerHTML = hits.map(e => {
      const c = HIST_DATA.CATS[e.cat];
      const badge = I18N.visibleInLang(e, I18N.lang) ? '' :
        `<span class="ed-hidden" title="${esc(I18N.t('edHiddenBadge',
          { lang: curMeta ? curMeta.native : I18N.lang }))}">🚫</span>`;
      /* a pin hidden in the UI language has no localized name — show the
       * first name it does have, so the row isn't blank */
      const dispName = I18N.entryName(e) ||
        TEXT_LANGS.map(code => e['name_' + code]).find(Boolean) || e.name || e.id;
      return `<div class="ed-hit" data-id="${esc(e.id)}">
        <span style="color:${c.color}">${e.t === 'p' ? '👤' : c.icon}</span>
        <span class="ed-hit-name">${esc(dispName)}</span>
        ${badge}
        <small>${e.y0 === e.y1 ? fmtYear(e.y0) : fmtYear(e.y0) + '–' + fmtYear(e.y1)}</small>
      </div>`;
    }).join('') || `<div class="ed-empty">${I18N.t('edNoMatches')}</div>`;
    box.querySelectorAll('.ed-hit').forEach(el =>
      el.onclick = () => loadForm(E().find(x => x.id === el.dataset.id)));
  }

  /* ── import / export ───────────────────────────────────────── */

  function exportDataJs() {
    const cats = JSON.stringify(HIST_DATA.CATS, null, 2);
    const tagGroups = JSON.stringify(HIST_DATA.TAG_GROUPS, null, 2);
    const tags = JSON.stringify(HIST_DATA.TAGS, null, 2);
    const entries = JSON.stringify(E().map(e => {
      const o = { id: e.id, t: e.t, cat: e.cat, name: e.name, y0: e.y0, y1: e.y1, lat: e.lat, lon: e.lon, place: e.place, d: e.d };
      if (e.src) o.src = e.src;
      if (e.path) o.path = e.path;
      if (e.tags) o.tags = e.tags.slice();
      for (const code of TEXT_LANGS)
        for (const b of ['name', 'place', 'd', 'src'])
          if (e[b + '_' + code]) o[b + '_' + code] = e[b + '_' + code];
      if (e.langs) o.langs = e.langs.slice();
      return o;
    }), null, 2);
    const text = `/* data.js — generated by the History Atlas editor on ${new Date().toISOString().slice(0, 10)}.\n` +
      ` * Drop this file over js/data.js to bake in all editor changes. */\n` +
      `(function () {\n  'use strict';\n  const CATS = ${cats};\n  const TAG_GROUPS = ${tagGroups};\n  const TAGS = ${tags};\n  const ENTRIES = ${entries};\n` +
      `  window.HIST_DATA = { CATS, TAG_GROUPS, TAGS, ENTRIES };\n})();\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    a.download = 'data.js';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(I18N.t('edExported', { n: E().length }));
  }

  function importJson(ev) {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(rd.result);
        if (!j || typeof j !== 'object' || (!j.up && !j.del)) throw 0;
        overrides.up = Object.assign(overrides.up, j.up || {});
        overrides.del = [...new Set([...overrides.del, ...(j.del || [])])];
        applyOverrides();
        persist();
        renderSearch();
        toast(I18N.t('edImported', { n: Object.keys(j.up || {}).length, m: (j.del || []).length }));
      } catch (e) { toast(I18N.t('edImportFail')); }
    };
    rd.readAsText(f);
  }

  async function changePassword() {
    const pw = prompt(I18N.t('edPwPrompt'));
    if (pw === null) return;
    if (pw === '') { localStorage.removeItem(LS_PW); return toast(I18N.t('edPwReset')); }
    localStorage.setItem(LS_PW, await sha256(pw));
    toast(I18N.t('edPwChanged'));
  }

  /* ── boot ──────────────────────────────────────────────────── */

  /* language switch: rebuild the editor DOM so labels re-translate
   * (form content is reset — switching languages mid-edit is rare) */
  window.addEventListener('langchange', () => {
    const ov = document.getElementById('editorOverlay');
    if (!ov) return;
    const wasOpen = ov.classList.contains('open');
    ov.remove();
    if (wasOpen) { build(); show(document.getElementById('editorOverlay')); }
  });

  snapshotOriginals();
  try { Object.assign(overrides, JSON.parse(localStorage.getItem(LS_OVR) || '{}')); } catch (e) {}
  overrides.up = overrides.up || {}; overrides.del = overrides.del || [];
  if (Object.keys(overrides.up).length || overrides.del.length) applyOverrides();
  fetch('data_overrides.json').then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return;
    overrides.up = Object.assign({}, j.up || {}, overrides.up);   // local wins
    overrides.del = [...new Set([...(j.del || []), ...overrides.del])];
    applyOverrides();
  }).catch(() => {});

  window.HIST_EDITOR = { open: openEditor };
})();
