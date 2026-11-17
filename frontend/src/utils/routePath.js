// Shared helpers for the journey view (start -> ordered stops -> destination).
// Rules mirror backend/services/roadRoute.js (routeWaypoints).
//   morning: start -> ordered pickup stops -> destination (college)
//   evening: destination (college) -> ordered evening stops; with no explicit
//            evening stops it is the morning journey reversed (ending at start).

export const hasLL = (p) =>
  Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude);

const asPlace = (p) =>
  hasLL(p) ? { name: p.name, latitude: p.latitude, longitude: p.longitude } : null;

export function journeyForShift(route, shift = "morning") {
  if (!route) return { start: null, destination: null, stops: [], path: null, pathStatus: "none" };
  const evening = shift === "evening";
  const morningStops = (route.stops || []).filter((s) => s && typeof s === "object");
  const eveningStops = (route.eveningStops || []).filter((s) => s && typeof s === "object");
  const useEveningStops = evening && eveningStops.length > 0;
  const stops = (useEveningStops ? eveningStops : morningStops).filter(hasLL);

  let start;
  let destination;
  if (!evening) {
    start = asPlace(route.start);
    destination = asPlace(route.destination);
  } else {
    start = asPlace(route.destination);
    destination = useEveningStops ? asPlace(stops[stops.length - 1]) : asPlace(route.start);
  }

  const raw = (evening ? route.eveningRoadPath : route.roadPath) || null;
  const ok = raw?.status === "ok" && Array.isArray(raw.coordinates) && raw.coordinates.length > 1;
  return {
    start,
    destination,
    stops,
    path: ok ? raw : null,
    pathStatus: ok ? "ok" : raw?.status === "unavailable" ? "unavailable" : "none",
  };
}

const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
function haversineM(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Distance left along the road path from the vertex nearest to `position`.
export function remainingAlongPath(coords, position) {
  if (!Array.isArray(coords) || coords.length < 2 || !hasLL(position)) return null;
  const cosLat = Math.cos(rad(position.latitude));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dy = coords[i][0] - position.latitude;
    const dx = (coords[i][1] - position.longitude) * cosLat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let total = 0;
  let remaining = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    total += seg;
    if (i > best) remaining += seg;
  }
  const offRouteMeters = haversineM([position.latitude, position.longitude], coords[best]);
  return { remainingMeters: remaining, totalMeters: total, offRouteMeters };
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "—";
  return meters < 950 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
