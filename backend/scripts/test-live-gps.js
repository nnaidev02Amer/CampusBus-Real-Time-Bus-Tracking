// End-to-end check of real-device GPS tracking over Socket.IO.
// Runs against an ISOLATED throwaway database (campusbus_gps_test) on a
// separate port, so demo data is never touched. Usage: node scripts/test-live-gps.js
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

dotenv.config();
const require = createRequire(import.meta.url);
const { io } = require("../../frontend/node_modules/socket.io-client");

const PORT = Number(process.env.GPS_TEST_PORT || 5056);
const URL_ = `http://127.0.0.1:${PORT}`;
const MONGO = "mongodb://127.0.0.1:27017/campusbus_gps_test";
const SECRET = "gps-test-secret";
process.env.MONGO_URI = MONGO;

const { default: User } = await import("../models/User.js");
const { default: Bus } = await import("../models/Bus.js");
const { default: Route } = await import("../models/Route.js");
const { default: BusStop } = await import("../models/BusStop.js");

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " – " + extra : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !fn()) await sleep(50); };

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(path, URL_),
      { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(URL_, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
  });

await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();

const mk = (role, n) => User.create({ name: `${role} ${n}`, email: `${role}${n}@gps.test`, role });
const [admin, driver, driver2, student] = await Promise.all([mk("admin", 1), mk("driver", 1), mk("driver", 2), mk("student", 1)]);
const route = await Route.create({ name: "Test Route", routeNumber: "T1", direction: "A to B" });
const stops = await BusStop.insertMany([
  { name: "A", routeId: route._id, latitude: 22.72, longitude: 75.85, sequence: 1 },
  { name: "B", routeId: route._id, latitude: 22.74, longitude: 75.87, sequence: 2 },
]);
route.stops = stops.map((s) => s._id);
await route.save();
const bus = await Bus.create({ busNumber: "T-1", registrationNumber: "REG-T1", routeId: route._id, driverId: driver._id });
const tok = (u) => jwt.sign({ id: u._id }, SECRET, { expiresIn: "1h" });

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  env: { ...process.env, PORT: String(PORT), MONGO_URI: MONGO, JWT_SECRET: SECRET, LOCATION_STALE_MS: "3000", NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
for (let i = 0; i < 40; i++) {
  try { const r = await api("GET", "/api/health"); if (r.status === 200) break; } catch {}
  await sleep(250);
}

try {
  // --- auth boundaries
  check("unauthenticated REST location is rejected", (await api("GET", `/api/buses/${bus._id}/location`)).status === 401);
  check("unauthenticated socket is rejected", await connect("").then(() => false, () => true));

  // --- driver starts trip
  const start = await api("POST", "/api/trips/start", { shift: "morning" }, tok(driver));
  check("driver starts trip", start.status === 201, `status ${start.status}`);
  const tripId = start.body.trip._id;
  check("student cannot start a trip", (await api("POST", "/api/trips/start", {}, tok(student))).status === 403);

  const studentSock = await connect(tok(student));
  studentSock.emit("student:track-bus", { busId: String(bus._id) });
  await sleep(200);
  const received = [];
  studentSock.on("bus:location", (d) => received.push(d));
  const driverSock = await connect(tok(driver));
  const errors = [];
  driverSock.on("location:error", (e) => errors.push(e.message));

  // --- real GPS stream reaches backend + student without refresh
  const fixes = [[22.7210, 75.8510], [22.7225, 75.8525], [22.7240, 75.8540]];
  for (const [latitude, longitude] of fixes) {
    driverSock.emit("driver:location", {
      busId: String(bus._id), tripId, latitude, longitude, speed: 22, heading: 45,
      accuracy: 12.5, timestamp: new Date().toISOString(), source: "simulator", // spoof attempt
    });
    await sleep(300);
  }
  await until(() => received.length >= 3);
  check("student received every driver fix live", received.length === 3, `got ${received.length}; errors: ${errors.join("|")}`);
  check("student sees coordinates move", received[0]?.latitude === 22.721 && received[2]?.latitude === 22.724);
  check("driver GPS tagged driver-gps (client cannot spoof source)", received.every((r) => r.source === "driver-gps"));
  check("accuracy forwarded", received[0]?.accuracy === 12.5);
  let b = await Bus.findById(bus._id);
  check("latest location persisted on bus", b.currentLocation.latitude === 22.724 && b.currentLocation.source === "driver-gps" && !!b.currentLocation.receivedAt);

  // --- REST snapshot (what a student sees on page load)
  const snap = await api("GET", `/api/buses/${bus._id}/location`, null, tok(student));
  check("REST snapshot is live with source", snap.body.isLive === true && snap.body.location?.source === "driver-gps");

  // --- authorization of writes
  const d2 = await connect(tok(driver2));
  const d2errs = [];
  d2.on("location:error", (e) => d2errs.push(e.message));
  d2.emit("driver:location", { busId: String(bus._id), tripId, latitude: 1, longitude: 1 });
  await until(() => d2errs.length > 0);
  check("unassigned driver rejected", d2errs.includes("Not assigned to this bus"));
  const before = received.length;
  studentSock.emit("driver:location", { busId: String(bus._id), tripId, latitude: 5, longitude: 5 });
  await sleep(800);
  check("student cannot publish locations", received.length === before);
  driverSock.emit("driver:location", { busId: String(bus._id), tripId, latitude: 999, longitude: 5 });
  driverSock.emit("driver:location", null);
  await until(() => errors.length >= 2);
  check("invalid coordinates / payload rejected", errors.includes("Invalid GPS coordinates") && errors.includes("Invalid location payload"), errors.join("|"));

  // --- stale detection when updates stop (LOCATION_STALE_MS=3000)
  await sleep(3500);
  const stale = await api("GET", `/api/buses/${bus._id}/location`, null, tok(student));
  check("snapshot reports stale after GPS stops", stale.body.stale === true && stale.body.status === "stale");

  // --- simulator remains separate and labelled
  const adminSock = await connect(tok(admin));
  received.length = 0;
  adminSock.emit("simulator:location", { busId: String(bus._id), tripId, latitude: 22.73, longitude: 75.86, speed: 30, accuracy: 8, timestamp: new Date().toISOString() });
  await until(() => received.length >= 1);
  check("simulator update delivered and tagged simulator", received.length === 1 && received[0].source === "simulator");
  adminSock.emit("simulator:location", { busId: String(bus._id), tripId, latitude: 22.73, longitude: 75.86 });
  d2.emit("simulator:location", { busId: String(bus._id), tripId, latitude: 1, longitude: 1 });
  await until(() => received.length >= 2);
  await sleep(500); // give a (wrongly) accepted non-admin update time to show up
  check("only admins may use simulator channel", received.length === 2);

  // --- end trip stops updates
  const tripEnded = new Promise((r) => studentSock.once("trip:ended", r));
  const stop = await api("POST", "/api/trips/stop", { tripId }, tok(driver));
  check("driver ends trip", stop.status === 200);
  await tripEnded;
  check("student notified of trip end", true);
  errors.length = 0;
  const n = received.length;
  driverSock.emit("driver:location", { busId: String(bus._id), tripId, latitude: 22.7, longitude: 75.8 });
  await until(() => errors.length > 0);
  check("location after trip end is rejected", errors.includes("Active trip not found") && received.length === n);
  b = await Bus.findById(bus._id);
  check("bus location cleared + offline after trip end", b.status === "offline" && !b.currentLocation?.latitude);

  // --- re-login / active trip restore
  const start2 = await api("POST", "/api/trips/start", { shift: "evening" }, tok(driver));
  const again = await api("POST", "/api/trips/start", { shift: "evening" }, tok(driver));
  check("second start while active -> 409 (client restores trip)", start2.status === 201 && again.status === 409);
  const active = await api("GET", "/api/trips/active", null, tok(driver));
  check("active trip discoverable after re-login", active.body.trips.some((t) => String(t._id) === start2.body.trip._id && String(t.driverId._id) === String(driver._id)));
  await api("POST", "/api/trips/stop", { tripId: start2.body.trip._id }, tok(driver));

  // --- prototype TEST MODE (driver-run simulated GPS on a bus with NO route)
  const bus2 = await Bus.create({ busNumber: "T-2", registrationNumber: "REG-T2", driverId: driver2._id });
  check("real trip on a route-less bus is refused (409)", (await api("POST", "/api/trips/start", { shift: "morning" }, tok(driver2))).status === 409);
  const tt = await api("POST", "/api/trips/start", { shift: "morning", testMode: true }, tok(driver2));
  check("driver can start a TEST trip on a route-less bus", tt.status === 201 && tt.body.trip.isTest === true && !tt.body.trip.routeId, `status ${tt.status}`);
  const testTripId = tt.body.trip._id;
  studentSock.emit("student:track-bus", { busId: String(bus2._id) });
  await sleep(200);
  received.length = 0;
  const d2err = [];
  d2.on("location:error", (e) => d2err.push(e.message));
  const testPts = [[22.7001, 75.8001], [22.7004, 75.8003], [22.7007, 75.8006]];
  for (const [latitude, longitude] of testPts) {
    d2.emit("driver:test-location", { busId: String(bus2._id), tripId: testTripId, latitude, longitude, speed: 30, heading: 10, accuracy: 5, timestamp: new Date().toISOString(), source: "driver-gps" });
    await sleep(250);
  }
  await until(() => received.length >= 3);
  check("student receives every simulated test update", received.length === 3 && received[2].latitude === 22.7007, `got ${received.length}`);
  check("test updates always tagged simulator (even if client claims driver-gps)", received.every((r) => r.source === "simulator"), d2err.join("|"));
  const b2 = await Bus.findById(bus2._id);
  check("test location persisted with source=simulator", b2.currentLocation.latitude === 22.7007 && b2.currentLocation.source === "simulator");
  const snap2 = await api("GET", `/api/buses/${bus2._id}/location`, null, tok(student));
  check("REST snapshot of test trip reports simulator source", snap2.body.location?.source === "simulator" && snap2.body.isLive === true);
  d2err.length = 0;
  d2.emit("driver:location", { busId: String(bus2._id), tripId: testTripId, latitude: 22.8, longitude: 75.9 });
  await until(() => d2err.length > 0);
  check("real GPS is rejected on a test trip", d2err.some((m) => /test-mode trip/.test(m)), d2err.join("|"));
  // test channel must not work on a real trip, for other drivers, or for students
  const real = await api("POST", "/api/trips/start", { shift: "morning" }, tok(driver));
  const realTripId = real.body.trip._id;
  const e1 = []; driverSock.on("location:error", (e) => e1.push(e.message));
  driverSock.emit("driver:test-location", { busId: String(bus._id), tripId: realTripId, latitude: 22.7, longitude: 75.8 });
  await until(() => e1.length > 0);
  check("test-location rejected on a real (non-test) trip", e1.some((m) => /only accepted for test-mode/.test(m)), e1.join("|"));
  e1.length = 0;
  driverSock.emit("driver:test-location", { busId: String(bus2._id), tripId: testTripId, latitude: 1, longitude: 1 });
  await until(() => e1.length > 0);
  check("other driver cannot send test locations for someone else's bus", e1.includes("Not assigned to this bus"), e1.join("|"));
  const n2 = received.length;
  studentSock.emit("driver:test-location", { busId: String(bus2._id), tripId: testTripId, latitude: 2, longitude: 2 });
  await sleep(800);
  check("student cannot send test locations", received.length === n2);
  await api("POST", "/api/trips/stop", { tripId: realTripId }, tok(driver));
  const ended2 = new Promise((r) => studentSock.once("trip:ended", r));
  check("driver ends the test trip", (await api("POST", "/api/trips/stop", { tripId: testTripId }, tok(driver2))).status === 200);
  await ended2;
  d2err.length = 0;
  d2.emit("driver:test-location", { busId: String(bus2._id), tripId: testTripId, latitude: 22.71, longitude: 75.81 });
  await until(() => d2err.length > 0);
  check("test location after test trip ended is rejected", d2err.includes("Active trip not found"));

  [studentSock, driverSock, d2, adminSock].forEach((s) => s.disconnect());
} finally {
  server.kill();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll live-GPS checks passed");
process.exit(failed ? 1 : 0);
