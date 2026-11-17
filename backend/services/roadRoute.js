// Road-following route geometry from OSRM (OpenStreetMap data, free, no API key).
// The public demo server is intended for light/prototype use. Point OSRM_BASE_URL
// at your own OSRM instance for anything heavier.
const OSRM_BASE_URL = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS) || 8000;
const USER_AGENT = "CampusBus-Academic-Prototype/1.0";

const hasCoords = (p) =>
  p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

// Waypoint rules (mirrored by frontend/src/utils/routePath.js):
//   morning: start -> ordered pickup stops -> destination
//   evening: destination (college) -> ordered evening stops; when no explicit
//            evening stops exist, the morning stops in reverse, ending at start.
export function routeWaypoints(route, shift = "morning") {
  const stops = (route.stops || []).filter(hasCoords);
  const eveningStops = (route.eveningStops || []).filter(hasCoords);
  const start = hasCoords(route.start) ? route.start : null;
  const destination = hasCoords(route.destination) ? route.destination : null;
  const pts =
    shift === "evening"
      ? eveningStops.length
        ? [destination, ...eveningStops]
        : [destination, ...[...stops].reverse(), start]
      : [start, ...stops, destination];
  return pts
    .filter(Boolean)
    .map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
}

// Douglas-Peucker (iterative) on [lat, lng] pairs; tolerance in metres.
export function simplifyPath(coords, toleranceMeters = 4) {
  if (coords.length < 3) return coords;
  const lat0 = coords[0][0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const pts = coords.map(([la, lo]) => [lo * kx, la * ky]);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceMeters) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

export async function fetchRoadPath(points) {
  if (points.length < 2) throw new Error("At least two locations are needed for a road route.");
  const coordString = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Routing service responded ${res.status}`);
    const json = await res.json();
    const r = json?.routes?.[0];
    if (json?.code !== "Ok" || !r?.geometry?.coordinates?.length)
      throw new Error(json?.message || `No drivable route found (${json?.code || "unknown"})`);
    const latlng = r.geometry.coordinates.map(([lng, lat]) => [
      Math.round(lat * 1e5) / 1e5,
      Math.round(lng * 1e5) / 1e5,
    ]);
    return {
      status: "ok",
      coordinates: simplifyPath(latlng),
      distanceMeters: Math.round(r.distance),
      durationSeconds: Math.round(r.duration),
      provider: "osrm",
      computedAt: new Date(),
    };
  } catch (err) {
    const detail = err?.cause?.code || err?.cause?.message;
    const message =
      err?.name === "AbortError"
        ? "Routing service timed out"
        : detail
          ? `${err.message} (${detail})`
          : err.message;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

// Never throws: a routing outage must not break saving a route or any map.
export async function computeShiftPath(route, shift) {
  const points = routeWaypoints(route, shift);
  if (points.length < 2) return null;
  try {
    return await fetchRoadPath(points);
  } catch (err) {
    console.warn(`[roadRoute] ${shift} path unavailable:`, err.message);
    return { status: "unavailable", error: String(err.message).slice(0, 200), computedAt: new Date() };
  }
}
