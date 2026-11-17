// Integration test for route journeys (start / destination / ordered stops / OSRM road path).
// Runs against an ISOLATED throwaway database (campusbus_route_test) with LOCAL MOCK
// OSRM and Nominatim servers, so it needs no network and never touches demo data.
// Usage: node scripts/test-routes.js   (or: npm run test:routes)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

dotenv.config();
const require = createRequire(import.meta.url);
void require;

const PORT = Number(process.env.ROUTE_TEST_PORT || 5059);
const OSRM_PORT = PORT + 11; // avoid fetch-blocked ports (5060/5061)
const NOM_PORT = PORT + 12;
const URL_ = `http://127.0.0.1:${PORT}`;
const MONGO = "mongodb://127.0.0.1:27017/campusbus_route_test";
const SECRET = "route-test-secret";
process.env.MONGO_URI = MONGO;

const { default: User } = await import("../models/User.js");
const { default: Route } = await import("../models/Route.js");
const { default: BusStop } = await import("../models/BusStop.js");
const { simplifyPath, routeWaypoints } = await import("../services/roadRoute.js");

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " - " + extra : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mock OSRM + Nominatim
const osrm = { mode: "ok", calls: [] };
const nom = { mode: "ok", search: 0, reverse: 0 };
const hav = (a, b) => {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const osrmServer = http.createServer((req, res) => {
  const m = /\/route\/v1\/driving\/([^?]+)/.exec(req.url);
  if (!m) { res.writeHead(404); return res.end(); }
  osrm.calls.push(m[1]);
  if (osrm.mode === "fail") { res.writeHead(500); return res.end("boom"); }
  if (osrm.mode === "noroute") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: "NoRoute", message: "Impossible route" })); }
  const pts = m[1].split(";").map((p) => p.split(",").map(Number)); // [lng,lat]
  const coords = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 8; k++) {
      const f = k / 8;
      const wobble = 0.0004 * Math.sin((i * 8 + k) * 1.3); // not a straight line
      coords.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f + wobble, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
    }
  }
  coords.push(pts[pts.length - 1]);
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += hav([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: "Ok", routes: [{ distance: dist * 1.2, duration: (dist * 1.2) / 9, geometry: { type: "LineString", coordinates: coords } }] }));
});
const nomServer = http.createServer((req, res) => {
  if (nom.mode === "down") { res.writeHead(503); return res.end(); }
  const u = new URL(req.url, "http://x");
  res.writeHead(200, { "Content-Type": "application/json" });
  if (u.pathname === "/search") {
    nom.search++;
    return res.end(JSON.stringify([
      { display_name: "Palasia Square, Indore, Madhya Pradesh, India", lat: "22.7244", lon: "75.8839" },
      { display_name: "Palasia, Indore, India", lat: "22.7239", lon: "75.8856" },
    ]));
  }
  nom.reverse++;
  res.end(JSON.stringify({ display_name: "Test Road, Test Area, Indore, India" }));
});
await new Promise((r) => osrmServer.listen(OSRM_PORT, "127.0.0.1", r));
await new Promise((r) => nomServer.listen(NOM_PORT, "127.0.0.1", r));

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(path, URL_),
      { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();
const mk = (role, n) => User.create({ name: `${role} ${n}`, email: `${role}${n}@route.test`, role });
const [admin, driver, student] = await Promise.all([mk("admin", 1), mk("driver", 1), mk("student", 1)]);
const tok = (u) => jwt.sign({ id: u._id }, SECRET, { expiresIn: "1h" });
const stops = await BusStop.insertMany([
  { name: "S1", latitude: 22.70, longitude: 75.85, sequence: 1 },
  { name: "S2", latitude: 22.71, longitude: 75.86, sequence: 2 },
  { name: "S3", latitude: 22.72, longitude: 75.87, sequence: 3 },
]);
const ids = stops.map((s) => String(s._id));
const START = { name: "Start Point", latitude: 22.69, longitude: 75.84 };
const DEST = { name: "College Gate", latitude: 22.74, longitude: 75.9 };

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  env: {
    ...process.env, PORT: String(PORT), MONGO_URI: MONGO, JWT_SECRET: SECRET, NODE_ENV: "test",
    OSRM_BASE_URL: `http://127.0.0.1:${OSRM_PORT}`, NOMINATIM_BASE_URL: `http://127.0.0.1:${NOM_PORT}`, NOMINATIM_MIN_INTERVAL_MS: "20",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
for (let i = 0; i < 40; i++) {
  try { if ((await api("GET", "/api/health")).status === 200) break; } catch {}
  await sleep(250);
}
const A = tok(admin);
const wp = (call) => call.split(";").map((p) => p.split(",").map(Number).reverse()); // -> [lat,lng]
const near = (p, q) => Math.abs(p[0] - q.latitude) < 1e-6 && Math.abs(p[1] - q.longitude) < 1e-6;

try {
  // ---- 0. pure helpers
  const line = [[0, 0], [0.0001, 0.0001], [0.0002, 0.0002], [0.0002, 0.001], [0.0002, 0.002]];
  const simp = simplifyPath(line, 3);
  check("0. path simplifier drops collinear points but keeps the corner", simp.length === 3 && simp[1][0] === 0.0002 && simp[1][1] === 0.0002, JSON.stringify(simp));
  const wpts = routeWaypoints({ start: START, destination: DEST, stops: [stops[0], stops[1]], eveningStops: [] }, "evening");
  check("0b. evening waypoints without evening stops = destination, reversed stops, start", wpts.length === 4 && wpts[0].latitude === DEST.latitude && wpts[3].latitude === START.latitude);

  // ---- 0c. road-path progress: forward-only, safe on routes that double back
  {
    const { applyPathProgress, clearPathProgress } = await import("../services/pathProgress.js");
    const pts = [];
    const leg = (a, b) => { for (let k = 0; k < 20; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20]); };
    leg([22.7, 75.85], [22.72, 75.85]); leg([22.72, 75.85], [22.72, 75.87]); leg([22.72, 75.87], [22.7, 75.87]); leg([22.7, 75.87], [22.7002, 75.8502]);
    pts.push([22.7002, 75.8502]); // the journey ENDS right next to where it started
    const mkStop = (i, lat, lng) => ({ _id: `s${i}`, name: `P${i}`, sequence: i, latitude: lat, longitude: lng });
    const pstops = [mkStop(1, 22.71, 75.85), mkStop(2, 22.72, 75.86), mkStop(3, 22.71, 75.87)];
    const proute = { roadPath: { status: "ok", coordinates: pts } };
    const legacy = (n) => ({ stopLocationAvailable: true, currentStop: null, nextStopIndex: n, nextStop: null });
    const nextAt = (trip, lat, lng, base = legacy(0)) => applyPathProgress({ tripId: trip, route: proute, shift: "morning", stops: pstops, position: { latitude: lat, longitude: lng }, tracking: base }).nextStopIndex;
    clearPathProgress("t1"); clearPathProgress("t2");
    const seq = [nextAt("t1", 22.7005, 75.85), nextAt("t1", 22.7155, 75.85), nextAt("t1", 22.72, 75.865), nextAt("t1", 22.71, 75.87)];
    check("0c. next stop advances along the road: P1 -> P2 -> P3 -> none left", seq.join() === "0,1,2,3", seq.join());
    check("0d. route that ends beside its start: bus near the start again does NOT regress", nextAt("t1", 22.7002, 75.8503) === 3);
    check("0e. a new trip at the same spot starts at the first stop", nextAt("t2", 22.7005, 75.85) === 0);
    clearPathProgress("t1");
    check("0f. progress is cleared at trip end", nextAt("t1", 22.7005, 75.85) === 0);
    const orig = legacy(2);
    const same = (r) => r === orig;
    check("0g. no road path / bus far off the road / stopped at a stop -> legacy tracking untouched",
      same(applyPathProgress({ tripId: "t3", route: {}, shift: "morning", stops: pstops, position: { latitude: 22.71, longitude: 75.85 }, tracking: orig })) &&
      same(applyPathProgress({ tripId: "t3", route: proute, shift: "morning", stops: pstops, position: { latitude: 22.9, longitude: 76.1 }, tracking: orig })) &&
      (() => {
        const atStop = { ...orig, currentStop: { _id: "s1" } };
        return applyPathProgress({ tripId: "t3", route: proute, shift: "morning", stops: pstops, position: { latitude: 22.71, longitude: 75.85 }, tracking: atStop }) === atStop;
      })());
  }

  // ---- 1. create with start + destination + ordered stops
  osrm.calls.length = 0;
  const c1 = await api("POST", "/api/routes", { name: "Journey Route", routeNumber: "J1", start: START, destination: DEST, stops: ids }, A);
  const r1 = c1.body.route;
  check("1. admin creates route with start, destination and stops", c1.status === 201 && r1.start?.name === "Start Point" && r1.destination?.name === "College Gate" && r1.stops.length === 3);
  check("1b. location names + coordinates stored", r1.start.latitude === 22.69 && r1.start.longitude === 75.84 && r1.destination.latitude === 22.74);
  check("1c. road path computed and stored (ok, >2 points, distance, duration)", r1.roadPath?.status === "ok" && r1.roadPath.coordinates.length > 10 && r1.roadPath.distanceMeters > 1000 && r1.roadPath.durationSeconds > 60 && r1.roadPath.provider === "osrm", `${r1.roadPath?.coordinates?.length} pts, ${r1.roadPath?.distanceMeters} m, ${r1.roadPath?.durationSeconds} s`);
  const morningCall = wp(osrm.calls[0]);
  check("1d. OSRM asked for start -> S1 -> S2 -> S3 -> destination in order", morningCall.length === 5 && near(morningCall[0], START) && near(morningCall[1], stops[0]) && near(morningCall[2], stops[1]) && near(morningCall[3], stops[2]) && near(morningCall[4], DEST));
  check("1e. path is not a straight line between waypoints (follows geometry)", r1.roadPath.coordinates.length > 5 * 2);
  const eveCall = wp(osrm.calls[1]);
  check("1f. evening path = destination, S3, S2, S1, start", r1.eveningRoadPath?.status === "ok" && near(eveCall[0], DEST) && near(eveCall[1], stops[2]) && near(eveCall[4], START));

  // ---- 2. reorder intermediate stops
  osrm.calls.length = 0;
  const reorder = [ids[2], ids[0], ids[1]];
  const u1 = await api("PUT", `/api/routes/${r1._id}`, { stops: reorder }, A);
  check("2. reordered intermediate stops are saved in the new order", u1.status === 200 && u1.body.route.stops.map((s) => String(s._id)).join() === reorder.join());
  const call2 = wp(osrm.calls[0]);
  check("2b. road path recomputed in the new order", near(call2[1], stops[2]) && near(call2[2], stops[0]) && near(call2[3], stops[1]));

  // ---- 3. edit destination -> recomputed, different distance
  const before = u1.body.route.roadPath.distanceMeters;
  const NEWDEST = { name: "New Campus", latitude: 22.8, longitude: 75.99 };
  osrm.calls.length = 0;
  const u2 = await api("PUT", `/api/routes/${r1._id}`, { destination: NEWDEST }, A);
  check("3. editing the destination recomputes the road path", u2.status === 200 && u2.body.route.destination.name === "New Campus" && u2.body.route.roadPath.distanceMeters !== before && near(wp(osrm.calls[0]).at(-1), NEWDEST), `${before} -> ${u2.body.route.roadPath.distanceMeters}`);

  // ---- 4. explicit evening stops
  osrm.calls.length = 0;
  const u3 = await api("PUT", `/api/routes/${r1._id}`, { eveningStops: [ids[1], ids[0]] }, A);
  const eve = wp(osrm.calls[1]);
  check("4. explicit evening stops: destination -> S2 -> S1 (no return to start)", u3.status === 200 && eve.length === 3 && near(eve[0], NEWDEST) && near(eve[1], stops[1]) && near(eve[2], stops[0]));

  // ---- 5. clear start
  osrm.calls.length = 0;
  const u4 = await api("PUT", `/api/routes/${r1._id}`, { start: null }, A);
  check("5. start can be cleared; path recomputed without it", u4.status === 200 && u4.body.route.start === null && wp(osrm.calls[0]).length === 4);

  // ---- 6. routing outage never breaks saving
  osrm.mode = "fail";
  const u5 = await api("PUT", `/api/routes/${r1._id}`, { destination: DEST }, A);
  check("6. OSRM down: route still saved (200) with status 'unavailable'", u5.status === 200 && u5.body.route.destination.name === "College Gate" && u5.body.route.roadPath.status === "unavailable" && !u5.body.route.roadPath.coordinates?.length, u5.body.route.roadPath?.error);
  const listDown = await api("GET", "/api/routes", null, tok(student));
  check("6b. route list still readable while routing is down", listDown.status === 200 && listDown.body.routes.length === 1);
  osrm.mode = "noroute";
  const u6 = await api("POST", `/api/routes/${r1._id}/recalculate`, null, A);
  check("6c. 'no route found' also handled gracefully", u6.status === 200 && u6.body.route.roadPath.status === "unavailable" && /Impossible|No drivable/.test(u6.body.route.roadPath.error), u6.body.route.roadPath.error);
  osrm.mode = "ok";
  const u7 = await api("POST", `/api/routes/${r1._id}/recalculate`, null, A);
  check("6d. recalculate recovers once routing is back", u7.status === 200 && u7.body.route.roadPath.status === "ok" && u7.body.route.roadPath.coordinates.length > 10);

  // ---- 7. validation
  const bad1 = await api("PUT", `/api/routes/${r1._id}`, { start: { name: "x", latitude: 200, longitude: 10 } }, A);
  const bad2 = await api("PUT", `/api/routes/${r1._id}`, { destination: { name: "x", latitude: 10 } }, A);
  const bad3 = await api("POST", "/api/routes", { name: "Bad", start: { latitude: "abc", longitude: 1 } }, A);
  check("7. invalid coordinates are rejected (400) and nothing is saved", bad1.status === 400 && bad2.status === 400 && bad3.status === 400 && (await Route.countDocuments({ name: "Bad" })) === 0);
  check("7b. rejected edits left the route unchanged", (await Route.findById(r1._id)).destination.name === "College Gate");

  // ---- 8. roadPath cannot be forged by clients
  const forged = await api("PUT", `/api/routes/${r1._id}`, { name: "Renamed", roadPath: { status: "ok", coordinates: [[1, 1], [2, 2]], distanceMeters: 1, durationSeconds: 1 } }, A);
  check("8. clients cannot write the cached road geometry", forged.status === 200 && forged.body.route.roadPath.coordinates.length > 10 && forged.body.route.name === "Renamed");

  // ---- 9. auth / roles
  check("9. student cannot create/edit/recalculate routes (403)", (await api("POST", "/api/routes", { name: "x" }, tok(student))).status === 403 && (await api("PUT", `/api/routes/${r1._id}`, { name: "x" }, tok(student))).status === 403 && (await api("POST", `/api/routes/${r1._id}/recalculate`, null, tok(student))).status === 403);
  check("9b. unauthenticated requests -> 401", (await api("GET", "/api/routes")).status === 401 && (await api("POST", "/api/routes", {})).status === 401);
  const stuView = await api("GET", `/api/routes/${r1._id}`, null, tok(student));
  const drvView = await api("GET", `/api/routes/${r1._id}`, null, tok(driver));
  check("9c. student and driver can READ the full journey + road path", stuView.body.route.roadPath?.status === "ok" && drvView.body.route.destination?.name === "College Gate" && stuView.body.route.stops.length === 3);

  // ---- 10. legacy routes preserved
  const legacy = await Route.create({ name: "Legacy Route", routeNumber: "L1", stops: [stops[0]._id, stops[1]._id] });
  osrm.calls.length = 0;
  const lg = await api("GET", `/api/routes/${legacy._id}`, null, tok(student));
  check("10. existing route without journey fields loads unchanged (start/destination/path null)", lg.status === 200 && lg.body.route.start === null && lg.body.route.destination === null && lg.body.route.roadPath === null && lg.body.route.stops.length === 2);
  const lgEdit = await api("PUT", `/api/routes/${legacy._id}`, { direction: "Old direction" }, A);
  check("10b. editing unrelated fields makes no routing calls and keeps stops", lgEdit.status === 200 && osrm.calls.length === 0 && lgEdit.body.route.stops.length === 2);
  const single = await api("POST", "/api/routes", { name: "One Stop", stops: [ids[0]] }, A);
  check("10c. fewer than two locations -> no routing call, no path, still saved", single.status === 201 && single.body.route.roadPath === null && osrm.calls.length === 0);

  // ---- 11. geocoding proxy (address search + reverse)
  const s1 = await api("GET", "/api/geocode/search?q=Palasia%20Indore", null, A);
  const s2 = await api("GET", "/api/geocode/search?q=Palasia%20Indore", null, A);
  check("11. address search returns named coordinates", s1.status === 200 && s1.body.results.length === 2 && s1.body.results[0].latitude === 22.7244 && /Palasia/.test(s1.body.results[0].name));
  check("11b. repeated search is cached (one upstream call)", nom.search === 1 && s2.body.results.length === 2);
  const rv = await api("GET", "/api/geocode/reverse?lat=22.7&lng=75.8", null, A);
  check("11c. reverse geocoding names a map click", rv.status === 200 && /Test Road/.test(rv.body.name));
  check("11d. geocoding is admin-only", (await api("GET", "/api/geocode/search?q=Palasia", null, tok(student))).status === 403 && (await api("GET", "/api/geocode/reverse?lat=1&lng=1", null, tok(driver))).status === 403 && (await api("GET", "/api/geocode/search?q=abc")).status === 401);
  check("11e. short queries / bad coordinates rejected", (await api("GET", "/api/geocode/search?q=ab", null, A)).status === 400 && (await api("GET", "/api/geocode/reverse?lat=abc&lng=1", null, A)).status === 400);
  nom.mode = "down";
  const sDown = await api("GET", "/api/geocode/search?q=Another%20Place", null, A);
  const rDown = await api("GET", "/api/geocode/reverse?lat=22.8&lng=75.9", null, A);
  check("11f. geocoder outage: search -> 502 with helpful message, reverse -> graceful null name", sDown.status === 502 && /pick the location on the map/.test(sDown.body.message) && rDown.status === 200 && rDown.body.name === null);
} finally {
  server.kill();
  osrmServer.close();
  nomServer.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll route journey checks passed");
process.exit(failed ? 1 : 0);
