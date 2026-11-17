// Prototype "test mode": generates SIMULATED bus movement starting from a real
// browser location. The bus drives a closed rectangular loop (north, east,
// south, west) around the origin so it stays near the tester and keeps moving.
// Pure functions only, no network or browser APIs, so they are easy to test.

const METERS_PER_DEG_LAT = 111320;

export function offsetMeters(point, northMeters, eastMeters) {
  const latitude = point.latitude + northMeters / METERS_PER_DEG_LAT;
  const longitude =
    point.longitude +
    eastMeters / (METERS_PER_DEG_LAT * Math.cos((point.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

export function distanceMeters(a, b) {
  const dLat = (b.latitude - a.latitude) * METERS_PER_DEG_LAT;
  const dLon =
    (b.longitude - a.longitude) *
    METERS_PER_DEG_LAT *
    Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

function bearingDegrees(from, to) {
  const dLat = to.latitude - from.latitude;
  const dLon =
    (to.longitude - from.longitude) * Math.cos((from.latitude * Math.PI) / 180);
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

export function createLoop(origin, sideMeters = 300) {
  const p0 = { latitude: origin.latitude, longitude: origin.longitude };
  const p1 = offsetMeters(p0, sideMeters, 0);
  const p2 = offsetMeters(p0, sideMeters, sideMeters);
  const p3 = offsetMeters(p0, 0, sideMeters);
  return [p0, p1, p2, p3];
}

// state = { loop, segment, travelled }  (travelled = metres along current segment)
export function createMovement(origin, sideMeters = 300) {
  return { loop: createLoop(origin, sideMeters), segment: 0, travelled: 0 };
}

export function currentPoint(state) {
  const a = state.loop[state.segment];
  const b = state.loop[(state.segment + 1) % state.loop.length];
  const len = Math.max(distanceMeters(a, b), 0.001);
  const f = Math.min(1, state.travelled / len);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
    heading: bearingDegrees(a, b),
  };
}

// Advances by `meters` along the loop (carrying leftover distance across corners).
export function advance(state, meters) {
  let { segment, travelled } = state;
  let remaining = meters;
  const n = state.loop.length;
  for (let guard = 0; guard < 16 && remaining > 0; guard++) {
    const a = state.loop[segment];
    const b = state.loop[(segment + 1) % n];
    const len = distanceMeters(a, b);
    const left = len - travelled;
    if (remaining < left) {
      travelled += remaining;
      remaining = 0;
    } else {
      remaining -= left;
      segment = (segment + 1) % n;
      travelled = 0;
    }
  }
  const next = { ...state, segment, travelled };
  return { state: next, point: currentPoint(next) };
}

export const kmhToMps = (kmh) => kmh / 3.6;
