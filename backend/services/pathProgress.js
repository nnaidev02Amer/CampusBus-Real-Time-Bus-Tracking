// Next-stop tracking along the actual ROAD path (OSRM geometry).
//
// The legacy logic (eta.js routeProgressFrom) matches the bus to the nearest
// straight segment BETWEEN STOPS, so on a route that doubles back (e.g. the
// destination is near the start) it can latch onto the wrong part of the
// journey and "next stop" jumps backwards. Here progress is measured along the
// road path and can only move FORWARD for a trip. If the road path is missing,
// unusable, or the bus is far off it, the original tracking is returned untouched.

const MAX_STOP_TO_PATH_M = 400; // a stop further than this from the path => not trustworthy
const MAX_BUS_TO_PATH_M = 2000; // bus further than this from the path => use legacy logic
const TIE_BREAK_M = 25; // near-equal distance candidates: prefer the earliest (start of a loop)

const lastIndexByTrip = new Map(); // tripId -> furthest path vertex reached

export function clearPathProgress(tripId) {
  lastIndexByTrip.delete(String(tripId));
}

const hasLL = (p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude);

function metersBetween(lat1, lng1, lat2, lng2) {
  const cos = Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lat2 - lat1) * 111320, (lng2 - lng1) * 111320 * cos);
}

function nearestVertex(path, lat, lng, fromIndex = 0) {
  let best = { index: fromIndex, dist: Infinity };
  for (let i = fromIndex; i < path.length; i++) {
    const d = metersBetween(lat, lng, path[i][0], path[i][1]);
    if (d < best.dist) best = { index: i, dist: d };
  }
  return best;
}

export function applyPathProgress({ tripId, route, shift, stops, position, tracking }) {
  try {
    if (!tracking?.stopLocationAvailable || tracking.currentStop) return tracking;
    const raw = shift === "evening" ? route?.eveningRoadPath : route?.roadPath;
    const path = raw?.status === "ok" ? raw.coordinates : null;
    if (!path || path.length < 2 || !stops?.length || !hasLL(position)) return tracking;
    if (!stops.every(hasLL)) return tracking;

    // Where each stop sits along the path; must follow the stop order.
    const stopHits = stops.map((s) => nearestVertex(path, s.latitude, s.longitude));
    if (stopHits.some((h) => h.dist > MAX_STOP_TO_PATH_M)) return tracking;
    for (let i = 1; i < stopHits.length; i++) {
      if (stopHits[i].index < stopHits[i - 1].index) return tracking;
    }

    const key = String(tripId);
    const prev = lastIndexByTrip.get(key) ?? 0;
    const best = nearestVertex(path, position.latitude, position.longitude, prev);
    if (best.dist > MAX_BUS_TO_PATH_M) return tracking;
    let busIndex = best.index;
    for (let i = prev; i < path.length; i++) {
      if (metersBetween(position.latitude, position.longitude, path[i][0], path[i][1]) <= best.dist + TIE_BREAK_M) {
        busIndex = i;
        break;
      }
    }
    lastIndexByTrip.set(key, busIndex);

    const next = stopHits.findIndex((h) => h.index > busIndex);
    const nextStopIndex = next === -1 ? stops.length : next;
    return {
      ...tracking,
      nextStopIndex,
      nextStop:
        nextStopIndex < stops.length
          ? {
              _id: stops[nextStopIndex]._id,
              name: stops[nextStopIndex].name,
              sequence: stops[nextStopIndex].sequence,
            }
          : null,
    };
  } catch (err) {
    console.warn("[pathProgress] falling back to legacy tracking:", err.message);
    return tracking;
  }
}
