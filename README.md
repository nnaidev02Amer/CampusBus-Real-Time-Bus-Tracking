# CampusBus

**Know where your bus is. Know when it arrives.**

CampusBus is a real-time college bus tracking system built as an **academic prototype**. A driver's phone streams its GPS position to the server, and students watch the bus move on an OpenStreetMap map with next-stop information, ETAs and live notifications. Admins manage buses, drivers, stops and routes, including road-following route geometry.

It is built with React + Vite on the frontend and Node.js + Express + MongoDB + Socket.IO on the backend. It uses only free technologies: browser Geolocation, OpenStreetMap tiles, OSRM routing and Nominatim address search. No paid map or GPS service and no Google Maps key is required.

> **Status:** this is a final-year/academic prototype. It demonstrates the full tracking flow end to end, but it has not been load-tested or hardened for production use. See [Known limitations](#known-limitations).

## Features

### Student
- Live bus marker on a Leaflet map with GPS status, accuracy, last-update time and connection state
- Complete assigned route: start, ordered stops, destination, road-following path, distance and estimated drive time
- Next stop, distance remaining along the road, and ETA
- Clear "signal lost" / offline state when GPS updates stop
- Notification bell with unread count: trip started, bus approaching your stop, bus arrived, trip ended, signal lost and GPS restored (see [Notifications](#notifications))
- Morning pickup and evening return views

### Driver
- Starts and ends trips from the **Trip** page; the browser's `watchPosition()` streams real GPS over Socket.IO
- GPS status (waiting, live, permission denied, unavailable, timed out), last-fix age, accuracy and server-link status
- Heartbeat so a parked bus is not shown as "signal lost"
- Active-trip recovery after refresh or re-login
- **Prototype test mode** with clearly labelled simulated GPS (see [Prototype simulated GPS](#prototype-simulated-gps))

### Admin
- Fleet, route, stop, user and trip management
- Driver lifecycle (create, edit, activate/deactivate, reset password, assign to a bus)
- Route journeys: starting location, final destination and ordered stops, with road geometry from OSRM (see [Routes and road routing](#routes-and-road-routing))
- **Admin → Simulator** to move a demo bus along its route for demonstrations

### Platform
- JWT authentication with student, driver and admin roles; role checks on every API and socket event
- Optional Firebase sign-in (Google / phone) and Supabase storage for profile photos
- Server-side GPS validation and driver-to-bus authorization
- Helmet, CORS, rate limiting, compression and environment-based configuration
- Installable PWA and responsive, mobile-first UI

## Technology stack

| Area | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, React Router, Leaflet / react-leaflet, Socket.IO client, lucide-react |
| Backend | Node.js, Express 5, Socket.IO, Mongoose, JWT, bcryptjs, helmet, express-rate-limit |
| Database | MongoDB |
| Maps and routing | OpenStreetMap tiles, OSRM (road routing), Nominatim (address search) |
| Optional services | Firebase Auth (Google / phone sign-in), Supabase Storage (profile photos) |

## Project structure

```text
CampusBus/
├── frontend/                # React + Vite app
│   └── src/ components/ hooks/ pages/ services/ utils/
└── backend/
    ├── config/ controllers/ middleware/ models/ routes/ services/ sockets/ views/
    ├── scripts/             # automated tests (see Testing)
    ├── server.js
    ├── seed.js              # DESTRUCTIVE demo-data reset (guarded), see Demo accounts
    └── create-admin.js / reset-admin-password.js
```

## Prerequisites

- Node.js 20 or newer and npm
- **MongoDB Community Server 7 or newer, installed and running on your own machine.** CampusBus uses a local MongoDB only; no cloud database account is needed
- A modern browser with the Geolocation API (a phone for real driver GPS)
- Internet access for map tiles and, for the route features, OSRM and Nominatim

## Installation and setup

### 0. Install and start MongoDB (local)

1. Download and install **MongoDB Community Server** from <https://www.mongodb.com/try/download/community> (on Windows the installer can run it as a service).
2. Make sure the MongoDB service is **running**:
   - Windows: it starts automatically if installed as a service; otherwise run `net start MongoDB` in an administrator terminal (or start the "MongoDB Server" service from Services).
   - macOS (Homebrew): `brew services start mongodb-community`
   - Linux (systemd): `sudo systemctl start mongod`
3. Optional check: `mongosh mongodb://127.0.0.1:27017` should connect.

MongoDB listens on `127.0.0.1:27017` by default, which is exactly what `backend/.env.example` expects. The database (`campusbus`) is created automatically on first use.

### 1. Backend

```bash
cd backend
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
npm install
npm run dev               # http://localhost:5000
```

`.env.example` already contains the local MongoDB connection string. In `backend/.env` set a strong random `JWT_SECRET` (the server refuses to start without one):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env      # optional for local development
npm install
npm run dev               # http://localhost:5173
```

The frontend talks to the backend on the **same hostname as the page, port 5000**: `http://localhost:5173` uses `http://localhost:5000`, and `http://<laptop-ip>:5173` uses `http://<laptop-ip>:5000`. Nothing is ever sent to a remote server. Set `VITE_API_URL` / `VITE_SOCKET_URL` only for an HTTPS tunnel or a backend on another host. See [Testing on a phone or another device](#testing-on-a-phone-or-another-device-lan).

When the backend starts it prints the database it connected to, e.g. `MongoDB connected (127.0.0.1:27017/campusbus)`.

### 3. First data

You can either create demo data in a **separate demo database** (see [Demo accounts](#demo-accounts)), or create your own admin and add data through the UI (see [Safe admin setup](#safe-admin-setup)). Neither touches an existing database.

Live ETAs and route progress require every route stop to have real latitude/longitude. Add stops under **Admin → Stops**, then attach them in order under **Admin → Routes**. Do not use placeholder coordinates.

## Environment variables

Never commit a real `.env` file. `.env` files are git-ignored; the committed `.env.example` files contain placeholders only.

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI` | yes | Local MongoDB connection string: `mongodb://127.0.0.1:27017/campusbus`. There is no default or fallback host |
| `JWT_SECRET` | yes | Long random secret used to sign login tokens |
| `PORT` | no | Backend port (default `5000`) |
| `CLIENT_URL`, `CORS_ORIGINS`, `SOCKET_IO_ORIGINS` | no | Allowed frontend origins (comma-separated) |
| `LOCATION_STALE_MS` | no | GPS older than this is "stale" / signal lost (default `120000`) |
| `BUS_STOPPED_SPEED_THRESHOLD_KMH`, `BUS_STOPPED_DURATION_MS`, `BUS_STOP_PROXIMITY_METERS` | no | When a bus counts as stopped at a stop (defaults `1.5`, `90000`, `120`) |
| `NODE_ENV` | no | Standard Node setting. It only changes the "Development" / "Production" label on the backend's status page |
| `SIGNAL_CHECK_MS` | no | How often the server checks for lost GPS (default `15000`) |
| `NOTIFY_APPROACH_MINUTES` | no | "Approaching" notification threshold (default `5`) |
| `DRIVER_TEST_MODE` | no | Set `false` to disable driver prototype test mode (default enabled) |
| `OSRM_BASE_URL`, `OSRM_TIMEOUT_MS` | no | Road-routing service (default public OSRM demo server) |
| `NOMINATIM_BASE_URL` | no | Address-search service (default public Nominatim) |
| `NOMINATIM_MIN_INTERVAL_MS` | no | Minimum delay between address-search requests (default `1100`). Keep it at 1000 or more to respect Nominatim's usage policy |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` | no | Only for Firebase (Google / phone) sign-in |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | no | Only for profile-photo uploads (handled by the backend). The service-role key is a server-side secret |
| `SUPABASE_KEY` | no | Legacy alias the backend accepts when `SUPABASE_SERVICE_ROLE_KEY` is not set. Prefer `SUPABASE_SERVICE_ROLE_KEY` |
| `SEED_CONFIRM_WIPE` | no | Used only by `npm run seed`. Leave unset normally; see the seed safeguard under [Demo accounts](#demo-accounts) |
| `CONFIRM_DB_WRITE` | no | Only for the database-writing scripts guarded by `backend/config/dbGuard.js`. Must equal the database name exactly. Leave unset normally; see [Database safety guard for other scripts](#database-safety-guard-for-other-scripts) |

### Frontend (`frontend/.env`)

| Variable | Purpose |
|---|---|
| `VITE_API_URL`, `VITE_SOCKET_URL` | Optional. Backend API and Socket.IO URLs. Default: same hostname as the page, port 5000. A `localhost` value is ignored when the page is opened from another device |
| `VITE_FIREBASE_*` | Your Firebase web-app config (only for Google / phone sign-in) |

All `VITE_*` values are compiled into the browser bundle and are public. Never put a secret in a `VITE_*` variable.

## MongoDB configuration

CampusBus is configured for a **local MongoDB only**.

- `backend/.env` uses `MONGO_URI=mongodb://127.0.0.1:27017/campusbus`. The backend reads the connection string only from this variable; there is no hidden default host, and it prints the host and database name when it connects.
- **Each developer keeps their own local database.** Data is not shared between machines, and nothing is stored in any cloud service. To share demo data, use the demo accounts below on your own machine.
- Never commit `backend/.env` (it is git-ignored). The committed `backend/.env.example` holds only local placeholders.
- **Tests use separate throwaway databases** (`campusbus_gps_test`, `campusbus_notif_test`, `campusbus_route_test`, `campusbus_authtest`). They create and drop only those databases and never touch your real data.

## Running the application

1. Start MongoDB.
2. `cd backend && npm run dev`
3. `cd frontend && npm run dev`
4. Open `http://localhost:5173` and sign in. (To use a phone on your network, see [Testing on a phone or another device](#testing-on-a-phone-or-another-device-lan).)

Useful commands:

| Command (in `backend`) | What it does |
|---|---|
| `npm run dev` / `npm start` | Start the API with / without file watching |
| `npm run seed` | **Destructive but guarded:** wipes the database in `MONGO_URI` and recreates demo data. Refuses unless the database name ends in `_demo`, `_seed` or `_test` (see [Creating demo data without resetting an existing database](#creating-demo-data-without-resetting-an-existing-database)) |
| `npm run admin:create` | Provision the first admin (see below) |
| `npm run admin:reset-password` | Reset an admin's password |

## Demo accounts

These are **local demo accounts created only by `npm run seed`**. They exist for development and demonstrations on your own machine.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@campusbus.demo` | `password123` |
| Driver | `driver@campusbus.demo` | `password123` |
| Student | `student@campusbus.demo` | `password123` |

The seed also creates a small demo route with six stops in Indore, a bus assigned to the demo driver, and the demo student assigned to that bus and a stop.

> **Warning:** `npm run seed` **deletes** all users, buses, routes, stops and trips in whichever database `MONGO_URI` points to, then recreates the demo data. Never run it against a database whose data you want to keep.

**Safeguard:** `seed.js` refuses to run unless the database name in `MONGO_URI` ends in `_demo`, `_seed` or `_test` (for example `campusbus_demo`). It checks this before connecting, so nothing is touched when it refuses. Pointing it at any other database, including your main `campusbus` one, requires setting `SEED_CONFIRM_WIPE` to that exact database name, which then wipes it. Do not set that variable unless you really intend to.

### Creating demo data without resetting an existing database

Seed a **separate local database** and run the backend against it. Your existing `campusbus` database is never touched.

PowerShell (backend folder):

```powershell
$env:MONGO_URI = "mongodb://127.0.0.1:27017/campusbus_demo"
npm run seed        # wipes and fills ONLY campusbus_demo
npm run dev         # the backend now uses campusbus_demo in this terminal
```

bash / zsh:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/campusbus_demo npm run seed
MONGO_URI=mongodb://127.0.0.1:27017/campusbus_demo npm run dev
```

The environment variable only applies to that terminal session; a normal `npm run dev` in a new terminal uses `backend/.env` (the `campusbus` database) again. To keep existing data and just get an admin account, use `npm run admin:create` instead (see [Safe admin setup](#safe-admin-setup)), then add buses, stops and routes through the admin screens.

### Database safety guard for other scripts

Besides `seed.js`, these scripts read or write whatever database `MONGO_URI` points to, so they share a guard (`backend/config/dbGuard.js`) that runs **before** any connection is opened:

- `add-route-02.js`, `add-route-07.js`, `configure-evening-schedules.js` (modify data)
- `scripts/test-auth-tokens.js`, `scripts/test-pwa-auth-lifecycle.js`, `scripts/test-all-scenarios.js`, `scripts/test-photo-upload-e2e.js` (create and modify test data)

Rules:

- By default they **refuse to run against the main `campusbus` database**, or any database that is not a throwaway one.
- They run without extra steps only when the database name ends in `demo`, `seed` or `test` (for example `campusbus_test`, `campusbus_demo`, `campusbus_authtest`).
- To deliberately run one against another database, set `CONFIRM_DB_WRITE` to **exactly** that database name. A different value does not work.
- `MONGO_URI` must name a database; a URI without one is refused.

```powershell
# Preferred: an isolated database
$env:MONGO_URI = "mongodb://127.0.0.1:27017/campusbus_test"
node add-route-07.js

# Deliberate override (the confirmation must match the database name)
$env:CONFIRM_DB_WRITE = "campusbus"
```

> **Warning:** `CONFIRM_DB_WRITE` permits these scripts to modify the named database, and they can overwrite existing records (routes, buses, stops, users). Treat it as authorizing destructive changes. Prefer a `_test` database, take a backup first, and unset the variable afterwards (`Remove-Item Env:CONFIRM_DB_WRITE`). Never put it in `backend/.env`, where it would silently authorize every later run.

## Live GPS requirements

- **HTTPS is required outside localhost.** Browsers expose the Geolocation API only in a secure context. `http://localhost` works; a phone opening `http://<your-pc-ip>:5173` will **not** get GPS. Deploy over HTTPS (or use an HTTPS tunnel) to test on a real phone.
- The driver must **allow location access**. If permission is denied or GPS is unavailable, the Trip page shows a clear message and a retry button.
- **Keep the Trip page open and the screen on.** Mobile browsers may throttle or pause GPS when the page is backgrounded or the phone sleeps. This prototype does **not** provide reliable background tracking. When updates stop, students see "signal lost" and are notified.
- Browsers only report GPS when the position changes, so the driver page re-sends the last real fix every 15 s while GPS is healthy. This heartbeat keeps a parked bus live and never fabricates a position.
- The browser uses a screen wake lock where supported to keep the display on while the page is visible. This is best-effort only.

## Testing on a phone or another device (LAN)

The frontend dev server and the backend both listen on all network interfaces, so a phone on the same Wi-Fi can open the app served by your laptop. Everything still goes to **your laptop's backend and local MongoDB**.

1. Find your laptop's IP address: `ipconfig` on Windows (IPv4 Address), `ifconfig` / `ip addr` on macOS and Linux. The examples below use `192.168.1.50`.
2. Allow that page origin in `backend/.env`, then restart the backend:
   ```env
   CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.50:5173
   SOCKET_IO_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.50:5173
   ```
3. Start both apps (`npm run dev` in `backend` and `frontend`). If your firewall asks, allow inbound connections for ports **5173** (frontend) and **5000** (backend).
4. On the phone open `http://192.168.1.50:5173`. No frontend setting is needed: the app calls `http://192.168.1.50:5000`.

How the frontend finds the backend: it uses `VITE_API_URL` / `VITE_SOCKET_URL` if set; otherwise the **same hostname as the page on port 5000**. A `localhost` / `127.0.0.1` value in those variables is ignored on the phone (there, "localhost" would mean the phone itself), so a copied `.env` cannot break phone testing.

Limits:
- **GPS needs HTTPS.** Over plain `http://<ip>` the Trip page cannot read location (neither real GPS nor "Use My Location" for test mode) and says so. Student, admin and notification screens work over HTTP.
- To test driver GPS on a phone, serve both apps over HTTPS (for example an HTTPS tunnel for the frontend and another for the backend). Then build or run the frontend with `VITE_API_URL=https://<backend-tunnel>/api` and `VITE_SOCKET_URL=https://<backend-tunnel>`, and add the frontend tunnel's origin to `CORS_ORIGINS` and `SOCKET_IO_ORIGINS`.
- If login shows a network error, check that the phone and laptop are on the same network, the IP is correct, the origin is in `CORS_ORIGINS` and the backend was restarted, and the firewall allows ports 5173 and 5000.

## Prototype simulated GPS

Two ways to demonstrate tracking without driving a bus. Both are clearly labelled **TEST MODE · SIMULATED GPS** on the student map, and the server always tags them as simulated. They never mix with real GPS.

**Driver test mode** (works even for a bus with no route):
1. Sign in as a driver and open **Trip**.
2. Tick **Prototype test mode (simulated GPS)**.
3. Press **Use My Location** (the simulated bus starts exactly there).
4. Press **Start Bus Movement**. The bus drives a simulated loop (about 300 m per side) at 15, 30 or 50 km/h.
5. Use **Pause / Resume / Stop**. Pause keeps the bus stopped in place without showing "signal lost".

Test mode can be disabled for a real deployment with `DRIVER_TEST_MODE=false`.

**Admin simulator:** **Admin → Simulator** moves a bus along its configured route stops. The bus must be assigned to a route.

## Routes and road routing

Under **Admin → Routes** each route has a **Journey** panel (and the create-route form has the same editor):

1. **Starting location** and **final destination:** search an address (OpenStreetMap Nominatim) or choose **Pick on map** and click the map. The location name stays editable. Name, latitude and longitude are stored in MongoDB.
2. **Ordered intermediate stops:** attach stops in order under the existing ordered-stops manager. Morning and evening orders are independent.
3. **Save journey.** The server asks **OSRM** (OpenStreetMap routing) for the road-following geometry and stores it with the route's distance and estimated duration. **Recalculate** re-requests it.

Students, drivers and the simulator then see the complete road path with distinct **Start**, numbered **Stop** and **Destination** markers, the distance and estimated drive time, and the next stop. If the routing service is unavailable, the route still saves and maps fall back to straight lines with a notice.

Rules to know:
- Morning journey: start → ordered stops → destination. Evening: destination → evening stops (or, with no evening stops, the morning route reversed).
- Routes without start/destination keep working exactly as before (straight lines between stops).
- If you change a stop's coordinates later, press **Recalculate** on the route.
- The public OSRM and Nominatim servers are free, fair-use services without an uptime guarantee; for heavy use run your own and set `OSRM_BASE_URL` / `NOMINATIM_BASE_URL`. OSRM durations are car-based estimates.

## Notifications

Students get in-app notifications through the bell in the header:

| Event | Sent to |
|---|---|
| Trip started / ended | Students assigned to that bus |
| Bus approaching (ETA within `NOTIFY_APPROACH_MINUTES`) | Students whose assigned stop it is |
| Bus arrived | Students whose assigned stop it is |
| Signal lost / GPS restored | Students assigned to that bus |

- A student must have an **assigned bus** (and an **assigned stop** for approaching/arrived).
- Notifications are stored in MongoDB (kept for 30 days) so they survive refresh and re-login. They are delivered live over Socket.IO to the student's private room only.
- Only state changes create notifications, so repeated GPS updates and heartbeats never repeat them.
- Native browser/OS notifications appear only if the student has allowed them and the page is open. There is no push service, so nothing is delivered while the app is closed.

## Safe admin setup

If the database has no active admin account, provision the first one from `backend` without clearing any existing records. In PowerShell:

```powershell
$env:ADMIN_NAME = "CampusBus Admin"
$env:ADMIN_EMAIL = "admin@example.edu"
$securePassword = Read-Host "Initial admin password" -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run admin:create
Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

The password must be at least 12 characters and is hashed with bcrypt. The command creates an account only when no active admin exists and never modifies other records. To change an existing active admin's password, run `npm run admin:reset-password` and enter the new password at the hidden prompt (minimum 8 characters).

## Managing drivers

Sign in as an admin and open **Drivers** (`/admin/drivers`). The page shows account status, assigned bus and route, current trip and last activity. Admins can add drivers, edit details, activate or deactivate accounts, reset passwords, and delete a driver only when inactive, unassigned and without trip history. Assign a driver to an existing bus from the Drivers or Buses page; a driver can be assigned to one bus at a time. Deactivated drivers cannot sign in or send GPS, and an account with an active trip cannot be deactivated. Password hashes are never returned by the API.

## Testing

The automated backend tests run against **isolated throwaway databases**, never your real one.

```bash
cd backend
npm run test:gps            # real + simulated GPS pipeline, roles, trip lifecycle
npm run test:notifications  # who gets which notification, dedupe, persistence, auth
npm run test:routes         # journeys, ordered stops, OSRM road path, fallback, geocoding, validation
cd ../frontend
npm run build               # production build check
```

Notes:
- MongoDB must be running locally. The test scripts start their own backend instance on a spare port and stop it afterwards.
- `test:gps`, `test:notifications` and `test:routes` load `socket.io-client` from `frontend/node_modules`, so run `npm install` in **both** `backend` and `frontend` first.
- `test:routes` uses local mock OSRM/Nominatim servers and needs no internet.
- `npm run test:auth` is a separate authentication test: it refuses to run unless `MONGO_URI` points at a database whose name contains `authtest`, and expects a backend started against that database (see the comment at the top of `scripts/test-auth.js`).
- `scripts/test-all-scenarios.js`, `test-photo-upload-e2e.js`, `test-auth-tokens.js` and `test-pwa-auth-lifecycle.js` are older manual scripts that use the database in your `.env`. Run them only against a disposable database.
- There are no automated frontend unit tests. Browser behaviour was verified manually with Playwright; those scripts are not part of this repository.

## API overview

Authentication: `POST /api/auth/register`, `/login`, `/firebase`, `/logout`; `GET /api/auth/me`; `PUT /api/auth/profile`; `POST|DELETE /api/auth/profile/photo`.

Buses: `GET /api/buses`, `GET /api/buses/:id`, `GET /api/buses/:id/location`; admin: `POST`, `PUT /:id`, `DELETE /:id`, `PUT /:id/driver`.

Routes: `GET /api/routes`, `GET /api/routes/:id`; admin: `POST`, `PUT /:id` (including `start`, `destination`, `stops`), `POST /:id/recalculate`, `DELETE /:id`.

Stops: `GET /api/stops`; admin: `POST`, `PUT /:id`, `PUT /reorder`, `DELETE /:id`.

Trips: `POST /api/trips/start` (driver; `{ "testMode": true }` for prototype test mode), `POST /api/trips/stop`, `GET /api/trips/active`, `GET /api/trips/:id`.

Notifications (students only): `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`, `DELETE /api/notifications/:id`, `DELETE /api/notifications`.

Geocoding (admin only): `GET /api/geocode/search?q=`, `GET /api/geocode/reverse?lat=&lng=`.

Users (admin only): `GET /api/users`, and driver management under `/api/users/drivers` (`POST`, `GET`, `PATCH /:id`, `PATCH /:id/status`, `PATCH /:id/password`, `DELETE /:id`).

Simulator (admin only): `POST /api/simulator/start`, `POST /api/simulator/stop`.

## Socket.IO contract

All connections must authenticate with a login token.

| Event | Direction | Notes |
|---|---|---|
| `driver:location` | driver → server | Real GPS: `busId`, `tripId`, `latitude`, `longitude`, `speed`, `heading`, `accuracy`, `timestamp`. Only the driver assigned to the bus |
| `driver:test-location` | driver → server | Simulated GPS for the driver's own test-mode trip; always stored as `source: "simulator"` |
| `simulator:location` | admin → server | Admin simulator; always `source: "simulator"` |
| `student:track-bus` / `student:untrack-bus` | student → server | Subscribe / unsubscribe to a bus |
| `bus:location` | server → students tracking the bus | Live position, `source`, next stop, ETAs |
| `trip:started`, `trip:ended` | server → students tracking the bus | Trip lifecycle |
| `notification:new` | server → that student only | Private per-user room |

## ETA behaviour

ETA uses the current GPS point, the ordered stops and a rolling average of recent speeds (30 km/h fallback), rounded to whole minutes. When a road path exists, progress and the next stop are measured along the road and can only move forward; otherwise a straight-line fallback is used.

## Deployment notes

CampusBus is intended to run on a developer machine against a **local MongoDB**, and the repository contains no hosting configuration. If you host it yourself (untested, outside the scope of this prototype): build the frontend with `npm run build` and serve `frontend/dist` over HTTPS; run the backend with `npm start` next to a MongoDB it can reach; set `VITE_API_URL` and `VITE_SOCKET_URL` when building the frontend; keep `JWT_SECRET`, `MONGO_URI` and any service keys in your host's secret settings (never in the repository); set `CLIENT_URL` / `CORS_ORIGINS` / `SOCKET_IO_ORIGINS` to your frontend origin; and serve everything over HTTPS/WSS.

## Known limitations

- **Prototype, not production-hardened.** It has not been load-tested. Live state (speed cache, route progress, notification de-duplication fast path) is kept in server memory, so run a single backend instance. Scaling out would need shared state such as Redis.
- **Local database only.** MongoDB runs on your own machine; there is no hosted database, so data is not shared between developers or reachable from other machines unless you set that up yourself.
- **Browser GPS only.** No native app, so there is no reliable background or screen-locked tracking. Accuracy depends on the device. HTTPS is required outside localhost.
- **Free OSM services.** The public OSRM and Nominatim servers are fair-use and may be slow or unavailable; durations are car-based estimates; address names depend on OpenStreetMap data (map clicks without a nearby name are labelled "Near <area> (lat, lng)" and can be renamed).
- **Road path upkeep.** Editing a stop's coordinates does not refresh the road path automatically. Press **Recalculate**.
- **Road-based next stop** applies when every stop lies within about 400 m of the path, in path order, and the bus is within about 2 km of it; otherwise the straight-line logic is used.
- **Notifications are in-app only**, require an assigned bus (and stop), and are removed after 30 days. No push notifications while the app is closed.
- **Driver test mode** lets a driver publish clearly labelled simulated positions for their own bus. Disable it with `DRIVER_TEST_MODE=false` in any real deployment.
- **Stop-arrival detection** uses a "stopped near the stop" rule (speed below the threshold for `BUS_STOPPED_DURATION_MS`), so a bus that never pauses at a stop may not register an arrival.

## License

Apache License 2.0. See [LICENSE](LICENSE).
