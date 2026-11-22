/* ── projection.js ────────────────────────────────────────────────
 * Lat/lon → normalized tile-space coordinates [0..1]².
 * The satellite tiles use EPSG:3395 (ellipsoidal Mercator, WGS84).
 * EPSG:3857 (spherical) is kept as an alternative for calibration;
 * switch with ?proj=3857 in the URL.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const R = 6378137;                 // WGS84 semi-major axis (m)
  const E = 0.081819190842621;       // WGS84 first eccentricity

  // EPSG:3395 ellipsoidal Mercator
  function mercY3395(latDeg) {
    const phi = latDeg * Math.PI / 180;
    const con = Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
    return R * Math.log(Math.tan(Math.PI / 4 + phi / 2) * con); // metres, + north
  }

  // EPSG:3857 spherical Mercator
  function mercY3857(latDeg) {
    const phi = latDeg * Math.PI / 180;
    return R * Math.log(Math.tan(Math.PI / 4 + phi / 2));
  }

  const params = new URLSearchParams(location.search);
  let use3395 = params.get('proj') !== '3857';

  const maxLat = 84.9; // keep well inside the square

  window.PROJ = {
    get name() { return use3395 ? 'EPSG:3395' : 'EPSG:3857'; },

    /** lat/lon → {nx, ny} normalized world coords (0,0 = top-left / NW). */
    fromLatLon(lat, lon) {
      const la = Math.max(-maxLat, Math.min(maxLat, lat));
      const y = use3395 ? mercY3395(la) : mercY3857(la);
      return {
        nx: (lon + 180) / 360,
        ny: 0.5 - y / (2 * Math.PI * R)
      };
    },

    /** normalized coords → lat/lon (bisection on the forward function). */
    toLatLon(nx, ny) {
      const lon = nx * 360 - 180;
      const target = (0.5 - ny) * 2 * Math.PI * R; // desired y in metres
      let lo = -85, hi = 85;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const y = use3395 ? mercY3395(mid) : mercY3857(mid);
        if (y > target) hi = mid; else lo = mid;   // y grows with lat: keep the root bracketed
      }
      return { lat: (lo + hi) / 2, lon };
    }
  };
})();
