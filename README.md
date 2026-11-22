# Atlas of World History

An **offline, standalone web app** that shows important historical events and
historical figures **at the same moment in time**, placed on a satellite world
map. Slide the golden time window along the bottom timeline and watch empires,
wars, discoveries and people appear and disappear together across the globe —
from the pyramids of Giza to the war in Ukraine.

Highlights:

- **Empire territories** — ~25 states (Rome, the Mongols, Kyivan Rus, the
  Ottoman Empire, the Cossack Hetmanate, the Commonwealth…) drawn as
  translucent outlines that fade in and out with the time window.
- **Guided tours** (🎬 in the top bar) — scripted fly-throughs: the Cossack
  State 1648–1709, the Age of Discovery, the World at 1500, and more.
- **Period-correct city names** — Constantinople becomes Istanbul, Edo becomes
  Tokyo; cities appear only from their founding year.
- **Travel paths** — dashed routes for Alexander, Ibn Battuta, the great
  voyages, Mansa Musa’s pilgrimage…
- **Shareable links** (🔗) — every view is encoded in the URL
  (`?y=1650&w=40&lat=49&lon=32&z=4`).
- **~300 events & figures** with source notes on contested topics, category
  filters, full-text search, playback, and a data validator (`?validate=1`).
- **Built-in marker editor** (🔒 button or Ctrl+Shift+E, password `atlas`) —
  add, edit and delete events & figures directly on the map; see below.
- **Installable PWA** — registers a service worker; after first load it also
  works from cache.

The satellite tiles (`world_map/tiles/`) are served locally; the app has
**zero external dependencies** (no CDN, no fonts, no libraries) and works
fully offline.

## Marker editor

Click **🔒** in the top bar (or press **Ctrl+Shift+E**) and enter the password
(**default: `atlas`** — change it with the 🔑 button inside the editor; the
new password is stored hashed in this browser). The gate is client-side, so
treat it as a deterrent rather than real security.

- **Add** — fill the form (negative year = BC, e.g. `-753` = 753 BC), use
  **📍 Pick on map** to set the position by clicking the map, add an optional
  travel path as `lat,lon` per line, then **💾 Save**.
- **Edit** — search an entry in the right column, or just click its marker
  while the editor is open.
- **Delete**, **Import changes** (a previously exported overrides JSON) and
  **↺ Reset all changes** are one click each.

Changes are saved to **`data_overrides.json` on disk** (the included
`serve.ps1` accepts the save request — `start_server.bat` uses it) and always
mirrored to the browser's localStorage, so nothing is lost under any server.
To bake edits permanently into the app itself, use **⬇ Export data.js** and
drop the downloaded file over `js/data.js`.

## Run it

**Windows (easiest):** double-click `start_server.bat`
(it uses Python if available, otherwise a built-in PowerShell server), then
open <http://localhost:8123/>.

Any machine, if you have Python:

```
cd history_map
python -m http.server 8123
```

Then open <http://localhost:8123/>. Browsers can also open `index.html`
directly from disk (file://), but a local server is faster and smoother.

## Using the app

- **Map** — drag to pan, scroll / pinch / double-click to zoom (levels 0–4
  and 7 are available; missing level-7 tiles automatically fall back to the
  coarser layer), ＋/−/🌍 buttons top-right.
- **Timeline** (bottom, full window width):
  - **drag the golden window** to travel through time;
  - **drag its edges** — or **scroll the mouse wheel over the timeline** — to
    change the window width (10–800 years);
  - **click** anywhere on the ruler to jump;
  - **click a colored bar** in the ribbon to open that event;
  - transport buttons: ⏮ start, ⏪/⏩ step one window, **▶ Play** animates
    time (Space), speed cycles 10/30/90/270 years-per-second;
  - − span / + span resize the window precisely.
- **Markers** — circles are events, rounded squares are historical figures
  (colored by category). A pulsing ring means it *began* inside the current
  window. Click a marker (or a list item) for details; the popup shows a
  person's age in the currently displayed year.
- **Clusters** — at low zoom, nearby pins collapse into gold count bubbles
  (Kyiv alone stacks 16 markers at year 1500). Click a bubble to drill in;
  above zoom 5 every pin shows individually and hovering lifts it above the
  stack. Hovering a pile of overlapping pins fans them out around the hovered
  one so each can be picked individually; they fold back when the pointer
  leaves.
- **Contemporaries** — open any *figure* and press ✨ Contemporaries: the
  window slides to cover their lifetime and the map shows exactly the people
  who shared the planet with them (Michelangelo and Columbus while Leonardo
  painted). Esc or the ✨ button exits.
- **Search** — the box top-right filters the current window *and* offers an
  all-time dropdown: pick (or press Enter) to jump straight to any entry,
  any millennium.
- **Side panel** — lists everything visible in the current window; filter by
  category chips, Events/Figures toggles, and the search box (also searches
  descriptions and places).
- **Keyboard** — ← / → nudge time, Shift+← / → a full window, Home/End jump
  to the era edges, Space play, +/− zoom, Esc closes the popup and exits
  contemporaries mode.
- **Playback** — pressing Play announces each era as you cross into it with
  a one-line chapter card.

## Data

`js/data.js` holds the dataset (~300 entries: events and people, with year
spans, coordinates, category and a short description). Add or edit entries
there — no build step, just refresh the page. Years use astronomical
numbering internally (1 BC = 0); Ukrainian-history entries use modern,
fact-checked, non-imperial terminology (Kyiv, Kyivan Rus, the Cossack
Hetmanate, Zaporozhian Sich…), and the most contested topics carry a short
source note in the popup.

Supporting layers, all editable data files:

- `js/territories.js` — coarse historical borders for the overlay
  (deliberately simplified; they show *where and when*, not survey lines);
- `js/cities.js` — city labels with period names and founding years;
- `js/tours.js` — guided-tour scripts;
- travel paths live on their entries in `data.js` (`byId.<id>.path`).

Run `?validate=1` to check the dataset (duplicate ids, date order, coords).
Run `?selftest=1` for the full built-in regression suite — 17 assertions
covering data integrity, projection round-trips, timeline maths, the zoom
floor, clustering, contemporaries, search jumps and overlay diffing. The tab
title becomes `SELFTEST OK` or `SELFTEST FAIL (n)`.

Categories: War & Conflict · Politics & Power · Empires & States · Religion ·
Science & Tech · Culture & Arts · Exploration · Disasters.

## Technical notes

- `js/projection.js` — EPSG:3395 (ellipsoidal Mercator — the projection used
  by the tiles) with an EPSG:3857 fallback: open `?proj=3857` to compare.
  Marker alignment was pixel-verified at zoom 7 against Istanbul's Golden Horn.
- `js/map.js` — dependency-free slippy-map engine (pan / wheel-zoom / pinch,
  tile pyramid `z{L}/{x}_{y}.jpg`, graceful fallback for missing tiles — the
  list of absent z7 tiles is preloaded from `world_map/missing.json`).
  The zoom floor is dynamic: fully zoomed out, the world always spans the
  viewport's smaller side — it can never shrink to a thumbnail.
- `js/timeline.js` — canvas timeline: era bands, adaptive ticks, clickable
  event ribbon, piecewise-nonlinear year scale so antiquity isn't crushed.
- `js/overlay.js` — travel paths and period city labels (diffed per frame, so
  animations don't restart while scrubbing); territory polygons are compiled
  in `js/territories.js` but currently disabled — flip `SHOW_TERRITORIES`
  to `true` to bring them back.
- `js/app.js` — wires everything: time-window filtering, markers with
  low-zoom clustering, contemporaries mode, all-time search jumps, popup,
  list, filters, playback with era chapters, tours, URL state, keyboard,
  saved view.
- `js/selftest.js` — the `?selftest=1` regression suite.
- `sw.js` + `manifest.webmanifest` — installable PWA; tiles cached on demand.
- `serve.ps1` — static server (+ `POST /api/save` for the editor); tiles are
  served `immutable` for a year, everything else revalidates.
- Imagery: locally hosted satellite tiles. For personal/educational use.
