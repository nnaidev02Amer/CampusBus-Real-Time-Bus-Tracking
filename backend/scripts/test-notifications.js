// Integration test for student live notifications.
// Runs against an ISOLATED throwaway database (campusbus_notif_test) on its own
// port with shortened timing thresholds, so demo data is never touched.
// Usage: node scripts/test-notifications.js   (or: npm run test:notifications)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

dotenv.config();
const require = createRequire(import.meta.url);
const { io } = require("../../frontend/node_modules/socket.io-client");

const PORT = Number(process.env.NOTIF_TEST_PORT || 5057);
const URL_ = `http://127.0.0.1:${PORT}`;
const MONGO = "mongodb://127.0.0.1:27017/campusbus_notif_test";
const SECRET = "notif-test-secret";
process.env.MONGO_URI = MONGO;

const { default: User } = await import("../models/User.js");
const { default: Bus } = await import("../models/Bus.js");
const { default: Route } = await import("../models/Route.js");
const { default: BusStop } = await import("../models/BusStop.js");
const { default: Notification } = await import("../models/Notification.js");

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " - " + extra : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !fn()) await sleep(50);
  return fn();
};

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
    s.on("connect_error", reject);
  });

await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();

const mk = (role, n, extra = {}) => User.create({ name: `${role} ${n}`, email: `${role}${n}@notif.test`, role, ...extra });
const route = await Route.create({ name: "Notif Route", routeNumber: "N1" });
const stops = await BusStop.insertMany([
  { name: "S1", latitude: 22.7, longitude: 75.85, sequence: 1 },
  { name: "S2", latitude: 22.71, longitude: 75.85, sequence: 2 },
  { name: "S3", latitude: 22.72, longitude: 75.85, sequence: 3 },
]);
route.stops = stops.map((s) => s._id);
await route.save();
const [admin, driver1, driver2] = await Promise.all([mk("admin", 1), mk("driver", 1), mk("driver", 2)]);
const bus1 = await Bus.create({ busNumber: "N-1", registrationNumber: "REG-N1", routeId: route._id, driverId: driver1._id });
const bus2 = await Bus.create({ busNumber: "N-2", registrationNumber: "REG-N2", driverId: driver2._id });
const studentA = await mk("student", 1, { assignedBusId: bus1._id, assignedStop: stops[1]._id }); // waits at S2
const studentA3 = await mk("student", 2, { assignedBusId: bus1._id, assignedStop: stops[2]._id }); // waits at S3
const studentB = await mk("student", 3, { assignedBusId: bus2._id });                              // different bus
const studentC = await mk("student", 4);                                                           // no bus
const tok = (u) => jwt.sign({ id: u._id }, SECRET, { expiresIn: "1h" });

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  env: {
    ...process.env, PORT: String(PORT), MONGO_URI: MONGO, JWT_SECRET: SECRET, NODE_ENV: "test",
    LOCATION_STALE_MS: "2500", SIGNAL_CHECK_MS: "500", BUS_STOPPED_DURATION_MS: "1000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
for (let i = 0; i < 40; i++) {
  try { if ((await api("GET", "/api/health")).status === 200) break; } catch {}
  await sleep(250);
}

const inbox = { A: [], A3: [], B: [], C: [] };
const types = (k) => inbox[k].map((n) => n.type);
const count = (k, t) => inbox[k].filter((n) => n.type === t).length;

try {
  // sockets for every student (+ driver) before anything happens
  const sock = {
    A: await connect(tok(studentA)), A3: await connect(tok(studentA3)),
    B: await connect(tok(studentB)), C: await connect(tok(studentC)),
  };
  for (const k of Object.keys(sock)) sock[k].on("notification:new", (n) => inbox[k].push(n));
  const d1 = await connect(tok(driver1));
  const d2 = await connect(tok(driver2));
  const errs = [];
  d1.on("location:error", (e) => errs.push(e.message));
  const fix = (lat, speed = 30) => d1.emit("driver:location", { busId: String(bus1._id), tripId, latitude: lat, longitude: 75.85, speed, heading: 0, accuracy: 6, timestamp: new Date().toISOString() });

  // ---- 1. trip started
  const start = await api("POST", "/api/trips/start", { shift: "morning" }, tok(driver1));
  const tripId = start.body.trip._id;
  await until(() => count("A", "trip_started") >= 1 && count("A3", "trip_started") >= 1);
  check("1. trip started -> assigned students notified live", count("A", "trip_started") === 1 && count("A3", "trip_started") === 1);
  check("1b. students of other buses / no bus NOT notified", inbox.B.length === 0 && inbox.C.length === 0);

  // ---- 2. approaching: repeated GPS updates must not repeat the notification
  for (let i = 0; i < 6; i++) { fix(22.695); await sleep(150); }
  await until(() => count("A", "bus_approaching") >= 1);
  await sleep(500);
  check("2. bus approaching -> student waiting at S2 notified", count("A", "bus_approaching") === 1, inbox.A.find((n) => n.type === "bus_approaching")?.message);
  check("2b. 6 repeated GPS updates produced ONE approaching notification (no duplicates)", count("A", "bus_approaching") === 1);
  check("2c. student whose stop is still far (S3) not yet notified", count("A3", "bus_approaching") === 0);

  // ---- 3. arrival at S2 (stopped near it), then continued updates do not repeat
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2600) { fix(22.7099, 0); await sleep(200); }
  await until(() => count("A", "bus_arrived") >= 1);
  await sleep(300);
  check("3. bus arrived at S2 -> student at S2 notified", count("A", "bus_arrived") === 1, inbox.A.find((n) => n.type === "bus_arrived")?.message);
  check("3b. repeated stopped updates did not duplicate arrival", count("A", "bus_arrived") === 1);
  check("3c. student at S3 not told about S2 arrival; is told S3 approaching", count("A3", "bus_arrived") === 0 && count("A3", "bus_approaching") === 1);

  // ---- 4. signal lost (updates stop), restored on next fix, heartbeats stay silent
  const lostBefore = count("A", "signal_lost");
  await until(() => count("A", "signal_lost") > lostBefore && count("A3", "signal_lost") >= 1, 8000);
  check("4. updates stop -> SIGNAL LOST notification", count("A", "signal_lost") === 1 && count("A3", "signal_lost") === 1);
  await sleep(2000);
  check("4b. no repeated signal-lost while still down", count("A", "signal_lost") === 1);
  check("4c. other bus's students not told", inbox.B.length === 0 && inbox.C.length === 0);
  fix(22.7099, 0);
  await until(() => count("A", "gps_restored") >= 1 && count("A3", "gps_restored") >= 1);
  check("5. next GPS fix -> GPS RESTORED notification", count("A", "gps_restored") === 1 && count("A3", "gps_restored") === 1);
  const totalBefore = inbox.A.length;
  for (let i = 0; i < 8; i++) { fix(22.7099, 0); await sleep(200); }
  await sleep(500);
  check("5b. 8 more heartbeat-style updates created NO notifications", inbox.A.length === totalBefore, `${totalBefore} -> ${inbox.A.length}`);
  // second outage = a new, distinct incident
  await until(() => count("A", "signal_lost") >= 2, 8000);
  fix(22.7099, 0);
  await until(() => count("A", "gps_restored") >= 2);
  check("5c. a second outage/recovery is reported again (distinct incident)", count("A", "signal_lost") === 2 && count("A", "gps_restored") === 2);

  // ---- 6. simulated (test-mode) trip on bus 2 -> only bus 2's student, source-agnostic
  const t2 = await api("POST", "/api/trips/start", { shift: "morning", testMode: true }, tok(driver2));
  await until(() => count("B", "trip_started") >= 1);
  check("6. simulated test trip start notifies ONLY that bus's student (marked test mode)", count("B", "trip_started") === 1 && /Test mode/.test(inbox.B[0].message) && count("A", "trip_started") === 1);
  d2.emit("driver:test-location", { busId: String(bus2._id), tripId: t2.body.trip._id, latitude: 22.7, longitude: 75.9, speed: 20, accuracy: 5 });
  await sleep(500);
  await api("POST", "/api/trips/stop", { tripId: t2.body.trip._id }, tok(driver2));
  await until(() => count("B", "trip_ended") >= 1);
  check("6b. simulated trip end notifies that bus's student only", count("B", "trip_ended") === 1 && count("A", "trip_ended") === 0);

  // ---- 7. trip ended
  await api("POST", "/api/trips/stop", { tripId }, tok(driver1));
  await until(() => count("A", "trip_ended") >= 1 && count("A3", "trip_ended") >= 1);
  check("7. trip ended -> assigned students notified once", count("A", "trip_ended") === 1 && count("A3", "trip_ended") === 1);
  check("7b. unrelated student C never received anything", inbox.C.length === 0);
  check("7c. student B only ever got its own bus's events", types("B").every((t) => ["trip_started", "trip_ended"].includes(t)) && inbox.B.every((n) => n.busId === String(bus2._id)));

  // ---- 8. REST: persistence, unread, read, clear, auth
  const listA = await api("GET", "/api/notifications", null, tok(studentA));
  const ids = listA.body.notifications.map((n) => n.id);
  check("8. persisted: REST returns everything the socket delivered", listA.status === 200 && ids.length === inbox.A.length && listA.body.unreadCount === inbox.A.length, `${ids.length} items, unread ${listA.body.unreadCount}`);
  check("8b. newest first + timestamps", listA.body.notifications[0].type === "trip_ended" && !!listA.body.notifications[0].createdAt);
  const afterRelogin = await api("GET", "/api/notifications", null, jwt.sign({ id: studentA._id }, SECRET, { expiresIn: "1h", jwtid: "second-login" }));
  check("8c. survives re-login (fresh token, same notifications)", afterRelogin.body.notifications.length === ids.length);
  const r1 = await api("POST", `/api/notifications/${ids[0]}/read`, null, tok(studentA));
  const l1 = await api("GET", "/api/notifications", null, tok(studentA));
  check("8d. mark one as read -> unread count decrements", r1.status === 200 && l1.body.unreadCount === ids.length - 1 && !!l1.body.notifications.find((n) => n.id === ids[0]).readAt);
  const foreign = await api("POST", `/api/notifications/${ids[1]}/read`, null, tok(studentB));
  const foreignDel = await api("DELETE", `/api/notifications/${ids[1]}`, null, tok(studentB));
  check("8e. another student cannot read/modify/delete my notification (404)", foreign.status === 404 && foreignDel.status === 404);
  const stillThere = await Notification.findById(ids[1]);
  check("8f. ...and it was left untouched", !!stillThere && !stillThere.readAt);
  const bList = await api("GET", "/api/notifications", null, tok(studentB));
  check("8g. student B list contains only B's own notifications", bList.body.notifications.length === 2 && bList.body.notifications.every((n) => n.busId === String(bus2._id)));
  check("8h. student C list is empty", (await api("GET", "/api/notifications", null, tok(studentC))).body.notifications.length === 0);
  const ra = await api("POST", "/api/notifications/read-all", null, tok(studentA));
  check("8i. mark all as read -> unread 0", ra.body.unreadCount === 0 && (await api("GET", "/api/notifications", null, tok(studentA))).body.unreadCount === 0);
  const del1 = await api("DELETE", `/api/notifications/${ids[2]}`, null, tok(studentA));
  check("8j. delete one", del1.status === 200 && (await api("GET", "/api/notifications", null, tok(studentA))).body.notifications.length === ids.length - 1);
  const clr = await api("DELETE", "/api/notifications", null, tok(studentA));
  const empty = await api("GET", "/api/notifications", null, tok(studentA));
  check("8k. clear all -> empty list, unread 0", clr.status === 200 && empty.body.notifications.length === 0 && empty.body.unreadCount === 0);
  check("8l. clearing mine did not touch student B's", (await api("GET", "/api/notifications", null, tok(studentB))).body.notifications.length === 2);
  check("8m. invalid id -> 404", (await api("POST", "/api/notifications/not-an-id/read", null, tok(studentA))).status === 404);

  // ---- 9. auth / roles
  check("9. no token -> 401", (await api("GET", "/api/notifications")).status === 401);
  check("9b. driver -> 403", (await api("GET", "/api/notifications", null, tok(driver1))).status === 403);
  check("9c. admin -> 403", (await api("GET", "/api/notifications", null, tok(admin))).status === 403);
  check("9d. unauthenticated socket cannot connect", await connect("").then(() => false, () => true));
  check("9e. real GPS pipeline stayed healthy (no location errors)", errs.length === 0, errs.join("|"));

  Object.values(sock).forEach((s) => s.disconnect());
  d1.disconnect(); d2.disconnect();
} finally {
  server.kill();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll notification checks passed");
process.exit(failed ? 1 : 0);
