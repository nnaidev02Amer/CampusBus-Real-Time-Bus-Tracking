// Address search / reverse geocoding through OpenStreetMap Nominatim (free, no key).
// Nominatim's usage policy requires: identify the app, at most 1 request/second,
// and caching. This server-side proxy does all three (admin-only endpoints).
const BASE = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const USER_AGENT = "CampusBus-Academic-Prototype/1.0";
const MIN_INTERVAL_MS = Number(process.env.NOMINATIM_MIN_INTERVAL_MS) || 1100;
const TTL_MS = 10 * 60 * 1000;

const cache = new Map();
let chain = Promise.resolve();
let lastCall = 0;

function throttled(task) {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return task();
  });
  chain = run.catch(() => {});
  return run;
}

async function get(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await throttled(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
  cache.set(path, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return data;
}

const shortName = (r) => {
  const parts = String(r.display_name || r.name || "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 3).join(", ") || "Selected location";
};

export async function searchPlaces(q) {
  const rows = await get(`/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ name: shortName(r), fullName: r.display_name, latitude: Number(r.lat), longitude: Number(r.lon) }))
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
}

// Prefer a specific place/road/area name. OSM often has none for an arbitrary
// map click, so fall back to "Near <district> (lat, lng)" to keep points distinguishable.
function reverseName(r, lat, lng) {
  const a = r.address;
  if (!a) return shortName(r);
  const specific = r.name || a.road || a.pedestrian || a.neighbourhood || a.suburb || a.amenity;
  const locality = a.suburb || a.city_district || a.city || a.town || a.village || a.county;
  if (specific) return locality && locality !== specific ? `${specific}, ${locality}` : specific;
  return `Near ${locality || "selected point"} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}

export async function reversePlace(lat, lng) {
  const r = await get(`/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`);
  return { name: r?.error ? null : reverseName(r, lat, lng), latitude: lat, longitude: lng };
}
