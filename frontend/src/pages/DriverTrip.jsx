import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { FlaskConical, LocateFixed, MapPin, Navigation, Pause, Play, Radio, Square, TriangleAlert } from "lucide-react";
import Layout from "../components/Layout";
import { SOCKET_URL, authApi, busApi, routeApi, tripApi } from "../services/api";
import { auth } from "../services/firebase";
import { useAuth } from "../hooks/useAuth";
import MapView from "../components/MapView";
import JourneySummary from "../components/JourneySummary";
import { journeyForShift } from "../utils/routePath";
import { advance, createMovement, currentPoint, kmhToMps } from "../utils/testMovement";

function getCleanToken(explicitToken = "") {
  let t =
    localStorage.getItem("campusbus_token") ||
    sessionStorage.getItem("campusbus_token") ||
    explicitToken ||
    "";
  if (typeof t === "string" && t.startsWith("Bearer ")) {
    t = t.slice(7).trim();
  }
  return typeof t === "string" ? t.trim() : "";
}

const SIM_TICK_MS = 2000;
const HEARTBEAT_MS = 15000;
const HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

export default function DriverTrip() {
  const { user } = useAuth();
  const [bus, setBus] = useState(null);
  const [route, setRoute] = useState(null);
  const [trip, setTrip] = useState(null);
  const [shift, setShift] = useState(() =>
    new Date().getHours() >= 13 ? "evening" : "morning"
  );
  const [tripLoading, setTripLoading] = useState(true);
  const [pos, setPos] = useState(null);
  const [gpsError, setGpsError] = useState("");
  // gpsState: idle | requesting | active | denied | unavailable | timeout | unsupported | insecure
  const [gpsState, setGpsState] = useState("idle");
  const [socketState, setSocketState] = useState("offline");
  const [lastFixAt, setLastFixAt] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const wakeLock = useRef(null);
  // --- Prototype test mode (simulated GPS) ---
  const [testMode, setTestMode] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [originBusy, setOriginBusy] = useState(false);
  const [simStatus, setSimStatus] = useState("idle"); // idle | running | paused
  const [simSpeed, setSimSpeed] = useState(30);
  const testModeRef = useRef(false);
  const simTimer = useRef(null);
  const simMove = useRef(null);
  const simPausedRef = useRef(false);
  const simSpeedRef = useRef(30);
  const gpsStateRef = useRef("idle");
  const lastFixAtRef = useRef(0);
  const socket = useRef(null);
  const watch = useRef(null);
  const latestPos = useRef(null);
  const busRef = useRef(null);
  const tripRef = useRef(null);
  const tripAuthConfig = useRef(null);
  const hasLoggedGpsFix = useRef(false);

  // Keep refs in sync for geolocation callbacks
  useEffect(() => {
    busRef.current = bus;
  }, [bus]);

  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);

  const releaseWakeLock = () => {
    try {
      wakeLock.current?.release?.();
    } catch {
      /* ignore */
    }
    wakeLock.current = null;
  };

  // Best effort only: keeps the screen on while the trip page is visible.
  // It does NOT make GPS reliable once the browser is backgrounded.
  const acquireWakeLock = async () => {
    try {
      if (wakeLock.current || !navigator.wakeLock?.request) return;
      wakeLock.current = await navigator.wakeLock.request("screen");
      wakeLock.current.addEventListener?.("release", () => {
        wakeLock.current = null;
      });
    } catch {
      /* unsupported or denied; GPS tracking still works */
    }
  };

  const stopGpsWatching = () => {
    if (watch.current != null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
    releaseWakeLock();
  };

  useEffect(() => {
    if (!trip) return undefined;
    const timer = setInterval(() => setNowTick(Date.now()), 5000);
    // Browsers only call watchPosition when the position CHANGES, so a parked bus
    // would otherwise go silent and be shown to students as "signal lost". While
    // the GPS is healthy (no error since the last fix, fix < HEARTBEAT_MAX_AGE_MS
    // old) re-send the last real fix, re-stamped, so the server knows we are alive.
    const heartbeat = setInterval(() => {
      const last = latestPos.current;
      if (
        last &&
        gpsStateRef.current === "active" &&
        !testModeRef.current &&
        Date.now() - lastFixAtRef.current < HEARTBEAT_MAX_AGE_MS &&
        socket.current?.connected
      ) {
        socket.current.emit("driver:location", {
          ...last,
          speed: 0,
          timestamp: new Date().toISOString(),
        });
      }
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNowTick(Date.now());
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const onOffline = () => setSocketState("reconnecting");
    const onOnline = () => {
      // Don't wait for Socket.IO's backoff timer once the network is back.
      const sock = socket.current;
      if (sock && !sock.connected) sock.connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip]);

  const startGpsWatching = (activeBusId, activeTripId) => {
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setGpsState("insecure");
      setGpsError(
        "Location tracking requires HTTPS or localhost. Please access the application via HTTPS."
      );
      return;
    }
    if (!navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("This browser does not support GPS location tracking.");
      return;
    }

    if (watch.current != null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }
    setGpsError("");
    setGpsState((prev) => (prev === "active" ? prev : "requesting"));
    acquireWakeLock();

    console.info("[DriverTrip] Requesting browser GPS watch.", {
      busId: activeBusId,
      tripId: activeTripId,
    });

    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const currentBus = busRef.current;
        const currentTrip = tripRef.current;
        const currentBusId = activeBusId || currentBus?._id;
        const currentTripId = activeTripId || currentTrip?._id;

        const payload = {
          busId: currentBusId,
          tripId: currentTripId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          speed:
            position.coords.speed == null
              ? null
              : Math.max(0, position.coords.speed * 3.6),
          heading: position.coords.heading,
          timestamp: new Date().toISOString(),
          accuracy: position.coords.accuracy,
        };

        latestPos.current = payload;
        setPos(payload);
        setGpsError("");
        gpsStateRef.current = "active";
        lastFixAtRef.current = Date.now();
        setGpsState("active");
        setLastFixAt(Date.now());

        if (socket.current?.connected) {
          socket.current.emit("driver:location", payload);
        }

        if (!hasLoggedGpsFix.current) {
          hasLoggedGpsFix.current = true;
          console.info("[DriverTrip] First GPS fix acquired and registered.", {
            tripId: payload.tripId,
            accuracyMeters: payload.accuracy,
            speedKmh: payload.speed,
          });
        }
      },
      (error) => {
        console.error("[DriverTrip] Browser GPS failed.", {
          code: error.code,
          message: error.message,
        });
        let msg = error.message;
        if (error.code === 1) {
          gpsStateRef.current = "denied";
          setGpsState("denied");
          // Permission was refused: stop the watcher; the driver can retry explicitly.
          stopGpsWatching();
          msg =
            "Location permission denied. Please allow location access in your browser settings to broadcast live bus location.";
        } else if (error.code === 2) {
          gpsStateRef.current = "unavailable";
          setGpsState("unavailable");
          msg =
            "GPS position unavailable. Please ensure GPS/location services are enabled on your device.";
        } else if (error.code === 3) {
          gpsStateRef.current = "timeout";
          setGpsState("timeout");
          msg = "Location request timed out. Waiting for GPS fix...";
        }
        setGpsError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  };

  const connectSocket = (assignedBus, activeTrip, explicitToken = "") => {
    if (socket.current) {
      socket.current.disconnect();
      socket.current = null;
    }

    const currentToken = getCleanToken(explicitToken);

    console.info("[DriverTrip] Connecting Socket.IO to:", SOCKET_URL);

    const connection = io(SOCKET_URL, {
      auth: (cb) => {
        cb({ token: getCleanToken(currentToken) });
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.current = connection;

    setSocketState("connecting");
    connection.on("connect", () => {
      setSocketState("connected");
      console.info("[DriverTrip] Socket.IO connected successfully.");
      if (latestPos.current) {
        connection.emit(
          testModeRef.current ? "driver:test-location" : "driver:location",
          latestPos.current,
        );
      }
    });

    connection.on("connect_error", async (error) => {
      setSocketState("reconnecting");
      console.error("[DriverTrip] Socket.IO connection failed.", {
        message: error.message,
      });

      if (
        error.message === "Invalid token" ||
        error.message === "Authentication required"
      ) {
        // 1. Try Firebase refresh if a Firebase session exists
        try {
          const fbUser = auth?.currentUser;
          if (fbUser) {
            const freshIdToken = await fbUser.getIdToken(true);
            const r = await authApi.firebaseLogin({ idToken: freshIdToken });
            if (r.data?.token) {
              localStorage.setItem("campusbus_token", r.data.token);
              connection.auth = { token: r.data.token };
              connection.connect();
              return;
            }
          }
        } catch (refreshErr) {
          console.warn("[DriverTrip] Firebase token refresh failed:", refreshErr);
        }

        // 2. Validate current session against REST API
        try {
          const meRes = await authApi.me();
          if (meRes.data?.user) {
            const freshToken = getCleanToken();
            if (freshToken) {
              connection.auth = { token: freshToken };
              connection.connect();
              return;
            }
          }
        } catch (meErr) {
          console.warn("[DriverTrip] REST session check failed:", meErr);
        }

        setGpsError(
          "Driver session has expired or is invalid. Please sign out and sign in again to broadcast live location."
        );
      } else {
        setGpsError(
          `Live connection notice: ${error.message || "connecting..."}. Local GPS is active.`
        );
      }
    });

    connection.on("disconnect", (reason) => {
      setSocketState("reconnecting");
      console.warn("[DriverTrip] Socket.IO disconnected.", { reason });
    });

    connection.on("location:accepted", (event) => {
      console.debug("[DriverTrip] Backend accepted a GPS update.", event);
      // Each ack carries the server's route tracking (the same data students see),
      // so NEXT STOP advances without any extra request or polling.
      const arrivals = Array.isArray(event?.stopArrivals) ? event.stopArrivals : null;
      const nextId = event?.nextStop?._id ? String(event.nextStop._id) : null;
      setTrip((prev) => {
        if (!prev) return prev;
        const arrivalsChanged =
          arrivals && (prev.stopArrivals || []).length !== arrivals.length;
        if (!arrivalsChanged && nextId === (prev.liveNextStopId || null)) return prev;
        return {
          ...prev,
          ...(arrivalsChanged ? { stopArrivals: arrivals } : {}),
          liveNextStopId: nextId,
        };
      });
    });

    connection.on("location:error", (event) => {
      console.error("[DriverTrip] Backend rejected a GPS update.", event);
      setGpsError(event.message || "The backend rejected the GPS update.");
    });

    return connection;
  };

  useEffect(() => {
    let cancelled = false;
    const loadDriverTrip = async () => {
      try {
        const response = await busApi.list();
        const driverId = user.id || user._id;
        const assignedBus = response.data.buses.find((item) => {
          const assignedDriverId =
            typeof item.driverId === "object" ? item.driverId?._id : item.driverId;
          return assignedDriverId === driverId;
        });
        if (cancelled) return;
        setBus(assignedBus || null);
        if (!assignedBus) {
          console.error("[DriverTrip] No bus is assigned to this driver.", {
            driverId,
          });
          setGpsError("No bus is assigned to your account. Contact an administrator.");
          return;
        }
        console.info("[DriverTrip] Assigned bus loaded.", {
          busId: assignedBus._id,
          busNumber: assignedBus.busNumber,
        });
        const routeId =
          typeof assignedBus.routeId === "string"
            ? assignedBus.routeId
            : assignedBus.routeId?._id;
        const [routeResponse, activeTripsResponse] = await Promise.all([
          routeId ? routeApi.get(routeId) : Promise.resolve(null),
          tripApi.active(),
        ]);
        if (cancelled) return;
        setRoute(routeResponse?.data.route || null);

        const activeTrip = activeTripsResponse.data.trips.find((item) => {
          const tripDriverId =
            typeof item.driverId === "object" ? item.driverId?._id : item.driverId;
          const tripBusId =
            typeof item.busId === "object" ? item.busId?._id : item.busId;
          return (
            item.status === "active" &&
            String(tripDriverId) === String(driverId) &&
            String(tripBusId) === String(assignedBus._id)
          );
        });

        if (activeTrip) {
          if (activeTrip.shift) setShift(activeTrip.shift);
          const token = getCleanToken();
          setTrip(activeTrip);
          setPos(assignedBus.currentLocation || null);
          console.info("[DriverTrip] Restored active trip after page load.", {
            tripId: activeTrip._id,
            busId: assignedBus._id,
            shift: activeTrip.shift,
          });
          if (token) {
            tripAuthConfig.current = {
              headers: { Authorization: `Bearer ${token}` },
            };
          }
          if (activeTrip.isTest) {
            // A test-mode trip: never attach the real GPS watcher to it.
            testModeRef.current = true;
            setTestMode(true);
          } else {
            // Start GPS watching immediately and connect socket
            startGpsWatching(assignedBus._id, activeTrip._id);
            connectSocket(assignedBus, activeTrip, token);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[DriverTrip] Failed to load assigned bus or active trip.", {
            status: error.response?.status,
            message: error.response?.data?.message || error.message,
          });
          setGpsError(
            error.response?.data?.message || "Could not load your assigned bus and trip.",
          );
        }
      } finally {
        if (!cancelled) setTripLoading(false);
      }
    };
    loadDriverTrip();
    return () => {
      cancelled = true;
      clearInterval(simTimer.current);
      stopGpsWatching();
      socket.current?.disconnect();
    };
  }, [user]);

  const start = async () => {
    setGpsError("");
    hasLoggedGpsFix.current = false;
    if (!bus) {
      console.error("[DriverTrip] Trip start blocked: no assigned bus is loaded.");
      setGpsError("No bus is assigned to your account. Contact an administrator.");
      return;
    }

    // 1. Prompt browser for GPS location IMMEDIATELY on the click event
    startGpsWatching(bus._id, null);

    console.info("[DriverTrip] Requesting trip start.", {
      busId: bus._id,
      busNumber: bus.busNumber,
      shift,
    });
    const token = getCleanToken();
    if (!token) {
      setGpsError("Your driver session has expired. Sign in again to start a trip.");
      return;
    }
    const authConfig = {
      headers: { Authorization: `Bearer ${token}` },
    };
    try {
      const r = await tripApi.start({ busId: bus._id, shift }, authConfig);
      tripAuthConfig.current = authConfig;
      const createdTrip = r.data.trip;
      setTrip(createdTrip);
      if (createdTrip?.shift) setShift(createdTrip.shift);
      console.info("[DriverTrip] Trip created.", {
        tripId: createdTrip._id,
        busId: createdTrip.busId,
        routeId: createdTrip.routeId,
        shift: createdTrip.shift,
      });

      // Update GPS watching with newly created tripId and connect socket
      startGpsWatching(bus._id, createdTrip._id);
      connectSocket(bus, createdTrip, token);
    } catch (e) {
      console.error("[DriverTrip] Trip start request failed.", {
        status: e.response?.status,
        message: e.response?.data?.message || e.message,
      });
      if (
        e.response?.status === 409 &&
        typeof e.response?.data?.message === "string" &&
        e.response.data.message.includes("already has an active trip")
      ) {
        try {
          const activeTripsResponse = await tripApi.active();
          const driverId = user.id || user._id;
          const existingTrip = activeTripsResponse.data.trips.find((item) => {
            const tripDriverId =
              typeof item.driverId === "object" ? item.driverId?._id : item.driverId;
            const tripBusId =
              typeof item.busId === "object" ? item.busId?._id : item.busId;
            return (
              item.status === "active" &&
              String(tripDriverId) === String(driverId) &&
              String(tripBusId) === String(bus._id)
            );
          });
          if (existingTrip) {
            setTrip(existingTrip);
            if (existingTrip.shift) setShift(existingTrip.shift);
            startGpsWatching(bus._id, existingTrip._id);
            connectSocket(bus, existingTrip, token);
            return;
          }
        } catch (recoverErr) {
          console.warn("[DriverTrip] Active trip recovery error:", recoverErr);
        }
      }
      setGpsError(e.response?.data?.message || "Could not start trip");
    }
  };

  // ---------------- Prototype test mode (simulated GPS) ----------------
  const resetSim = () => {
    clearInterval(simTimer.current);
    simTimer.current = null;
    simMove.current = null;
    simPausedRef.current = false;
    setSimStatus("idle");
  };

  const locateMe = () => {
    setGpsError("");
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setGpsError("Location access requires HTTPS or localhost.");
      return;
    }
    if (!navigator.geolocation) {
      setGpsError("This browser does not support location access.");
      return;
    }
    setOriginBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOrigin({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        });
        setOriginBusy(false);
      },
      (error) => {
        setOriginBusy(false);
        setGpsError(
          error.code === 1
            ? "Location permission denied. Allow location access to use your current location as the test start point."
            : error.code === 2
              ? "Your location is unavailable. Turn on location services and try again."
              : "Timed out getting your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // Emits one SIMULATED position. `hold` re-sends the current point with speed 0
  // (used for the first point at the start location and while paused).
  const simTick = (hold = false, bus_ = busRef.current, trip_ = tripRef.current) => {
    if (!bus_ || !trip_ || !simMove.current) return;
    const holding = hold || simPausedRef.current;
    let point;
    if (holding) {
      point = currentPoint(simMove.current);
    } else {
      const r = advance(simMove.current, kmhToMps(simSpeedRef.current) * (SIM_TICK_MS / 1000));
      simMove.current = r.state;
      point = r.point;
    }
    const payload = {
      busId: bus_._id,
      tripId: trip_._id,
      latitude: point.latitude,
      longitude: point.longitude,
      speed: holding ? 0 : simSpeedRef.current,
      heading: point.heading,
      accuracy: 5,
      timestamp: new Date().toISOString(),
      source: "simulator",
    };
    latestPos.current = payload;
    setPos(payload);
    setLastFixAt(Date.now());
    if (socket.current?.connected) socket.current.emit("driver:test-location", payload);
  };

  const startMovement = async () => {
    if (!origin || !bus) return;
    setGpsError("");
    const token = getCleanToken();
    if (!token) {
      setGpsError("Your driver session has expired. Sign in again to start a test trip.");
      return;
    }
    const authConfig = { headers: { Authorization: `Bearer ${token}` } };
    try {
      let activeTrip = trip;
      if (!activeTrip) {
        const r = await tripApi.start({ busId: bus._id, shift, testMode: true }, authConfig);
        activeTrip = r.data.trip;
        tripAuthConfig.current = authConfig;
        setTrip(activeTrip);
        if (activeTrip?.shift) setShift(activeTrip.shift);
      } else if (!tripAuthConfig.current) {
        tripAuthConfig.current = authConfig;
      }
      testModeRef.current = true;
      connectSocket(bus, activeTrip, token);
      acquireWakeLock();
      simMove.current = createMovement(origin, 300);
      simPausedRef.current = false;
      setSimStatus("running");
      clearInterval(simTimer.current);
      simTick(true, bus, activeTrip); // first point = exactly your location
      simTimer.current = setInterval(() => simTick(), SIM_TICK_MS);
    } catch (e) {
      setGpsError(e.response?.data?.message || "Could not start the test trip.");
    }
  };

  const pauseMovement = () => {
    simPausedRef.current = true;
    setSimStatus("paused");
  };
  const resumeMovement = () => {
    simPausedRef.current = false;
    setSimStatus("running");
  };

  const stop = async () => {
    // Halt the simulation first so no tick can hit the trip while it is being ended.
    clearInterval(simTimer.current);
    simTimer.current = null;
    try {
      if (trip) {
        console.info("[DriverTrip] Requesting trip stop.", { tripId: trip._id });
        await tripApi.stop(
          { tripId: trip._id },
          tripAuthConfig.current || undefined,
        );
        setTrip(null);
        tripAuthConfig.current = null;
      }
    } catch (error) {
      console.error("[DriverTrip] Trip stop request failed.", {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      setGpsError(error.response?.data?.message || "Could not stop trip.");
      resetSim(); // the timer is already halted; keep the UI consistent
      return;
    }
    resetSim();
    stopGpsWatching();
    socket.current?.disconnect();
    socket.current = null;
    latestPos.current = null;
    setPos(null);
    gpsStateRef.current = "idle";
    setGpsState("idle");
    setSocketState("offline");
    setLastFixAt(null);
    setGpsError("");
  };
  const fixAgeSec = lastFixAt ? Math.max(0, Math.round((nowTick - lastFixAt) / 1000)) : null;
  const gpsLost = gpsState === "active" && fixAgeSec != null && fixAgeSec > HEARTBEAT_MAX_AGE_MS / 1000;
  const gpsLabel = testMode && trip
    ? { text: "SIMULATED (test mode)", tone: "text-fuchsia-700" }
    : !trip
    ? { text: "Off", tone: "" }
    : gpsLost
      ? { text: "No recent fix", tone: "text-amber-700" }
      : {
          idle: { text: "Waiting", tone: "" },
          requesting: { text: "Waiting for GPS fix…", tone: "text-amber-700" },
          active: { text: "Live GPS", tone: "text-emerald-700" },
          denied: { text: "Permission denied", tone: "text-red-700" },
          unavailable: { text: "GPS unavailable", tone: "text-red-700" },
          timeout: { text: "GPS timed out", tone: "text-amber-700" },
          unsupported: { text: "Not supported", tone: "text-red-700" },
          insecure: { text: "HTTPS required", tone: "text-red-700" },
        }[gpsState] || { text: "Waiting", tone: "" };
  const testPanel = (
    <div
      data-testid="test-panel"
      className="mt-5 space-y-3 rounded-xl border-2 border-dashed border-fuchsia-400 bg-fuchsia-50 p-3 text-slate-800"
    >
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-fuchsia-800">
        <FlaskConical size={15} /> TEST MODE · SIMULATED GPS
      </div>
      <p className="text-[11px] leading-snug text-fuchsia-900">
        Prototype testing only. The bus drives a simulated loop (about 300 m per side) starting at
        your current location. Students see it clearly labelled as simulated. Real GPS is not used.
      </p>
      <button
        type="button"
        onClick={locateMe}
        disabled={originBusy || simStatus !== "idle"}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-sm font-bold text-fuchsia-800 ring-1 ring-fuchsia-300 hover:bg-fuchsia-100 disabled:opacity-60"
      >
        <LocateFixed size={16} /> {originBusy ? "Locating…" : "Use My Location"}
      </button>
      {origin && (
        <p data-testid="test-origin" className="text-xs font-semibold text-fuchsia-900">
          Start: {origin.latitude.toFixed(5)}, {origin.longitude.toFixed(5)}
          {Number.isFinite(origin.accuracy) ? ` (±${Math.round(origin.accuracy)} m)` : ""}
        </p>
      )}
      <label className="flex items-center justify-between gap-2 text-xs font-bold text-fuchsia-900">
        Bus speed
        <select
          value={simSpeed}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSimSpeed(v);
            simSpeedRef.current = v;
          }}
          className="rounded-md border border-fuchsia-300 bg-white px-2 py-1 text-xs"
        >
          <option value={15}>15 km/h</option>
          <option value={30}>30 km/h</option>
          <option value={50}>50 km/h</option>
        </select>
      </label>
      {simStatus === "idle" ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={startMovement}
            disabled={!origin || !bus || tripLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-600 py-3 font-black text-white hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={17} /> START BUS MOVEMENT
          </button>
          {trip && (
            <button
              type="button"
              onClick={stop}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-black text-white hover:bg-red-700"
            >
              <Square size={15} /> END TEST TRIP
            </button>
          )}
          {!origin && (
            <p className="text-[11px] text-fuchsia-800">Tap “Use My Location” first.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p data-testid="sim-status" className="text-xs font-bold text-fuchsia-900">
            {simStatus === "paused"
              ? "Paused – bus is stopped"
              : `Running – simulated ${simSpeed} km/h`}
            {Number.isFinite(pos?.latitude)
              ? ` · ${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`
              : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {simStatus === "running" ? (
              <button
                type="button"
                onClick={pauseMovement}
                className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-black text-white hover:bg-amber-600"
              >
                <Pause size={16} /> PAUSE
              </button>
            ) : (
              <button
                type="button"
                onClick={resumeMovement}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-black text-white hover:bg-emerald-700"
              >
                <Play size={16} /> RESUME
              </button>
            )}
            <button
              type="button"
              onClick={stop}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 font-black text-white hover:bg-red-700"
            >
              <Square size={16} /> STOP
            </button>
          </div>
        </div>
      )}
    </div>
  );
  const currentShift = trip?.shift || shift;
  const journey = journeyForShift(route, currentShift);
  const displayStops =
    currentShift === "evening" && route?.eveningStops?.length
      ? route.eveningStops
      : route?.stops || [];

  const completedStopIds = new Set(
    (trip?.stopArrivals || []).map((a) => String(a.stopId || a.stopName))
  );
  const nextStop =
    (trip?.liveNextStopId &&
      displayStops.find((s) => String(s._id) === trip.liveNextStopId)) ||
    displayStops.find(
      (s) => !completedStopIds.has(String(s._id || s.name))
    ) ||
    displayStops[displayStops.length - 1];

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="text-sm font-bold text-blue-600">DRIVER MODE</p>
          <h1 className="mt-1 text-3xl font-black">
            {bus?.busNumber || "Assigned bus"}
          </h1>
          <p className="text-sm text-slate-500">
            {route?.name || (tripLoading ? "Loading route…" : "No route assigned")}
            {testMode && (
              <span className="ml-2 rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-black uppercase text-fuchsia-800">
                TEST MODE · SIMULATED GPS
              </span>
            )}
          </p>
        </div>
        {(journey.start || journey.destination) && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <JourneySummary
              route={route}
              shift={currentShift}
              live={trip ? pos : null}
              nextStopName={nextStop?.name || ""}
              className="border-b-0"
            />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="h-[55vh] min-h-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <MapView
              location={pos}
              stops={displayStops}
              route={displayStops}
              start={journey.start}
              destination={journey.destination}
              roadPath={journey.path}
              pathStatus={journey.pathStatus}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between text-sm font-bold">
                <div className="flex items-center gap-2">
                  <Radio
                    size={18}
                    className={
                      trip ? "text-emerald-600 pulse-soft" : "text-slate-400"
                    }
                  />{" "}
                  {trip ? "Trip Active" : "Trip Offline"}
                </div>
                {trip && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${currentShift === "evening"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-blue-100 text-blue-800"
                      }`}
                  >
                    {currentShift === "evening" ? "🌆 Evening" : "🌅 Morning"}
                  </span>
                )}
              </div>

              {!trip && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Select Trip Shift
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShift("morning")}
                      className={`rounded-lg py-2 text-xs font-bold transition-all ${shift === "morning"
                        ? "bg-white text-blue-700 shadow-sm ring-1 ring-blue-300"
                        : "text-slate-600 hover:text-slate-900"
                        }`}
                    >
                      🌅 Morning Pickup
                    </button>
                    <button
                      type="button"
                      onClick={() => setShift("evening")}
                      className={`rounded-lg py-2 text-xs font-bold transition-all ${shift === "evening"
                        ? "bg-white text-amber-700 shadow-sm ring-1 ring-amber-300"
                        : "text-slate-600 hover:text-slate-900"
                        }`}
                    >
                      🌆 Evening Drop
                    </button>
                  </div>
                </div>
              )}

              {!trip && (
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    data-testid="test-mode-toggle"
                    checked={testMode}
                    onChange={(e) => {
                      setTestMode(e.target.checked);
                      testModeRef.current = e.target.checked;
                      setGpsError("");
                    }}
                  />
                  Prototype test mode (simulated GPS)
                </label>
              )}
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-xs uppercase text-slate-400">GPS</p>
                  <p className={`mt-1 font-bold ${gpsLabel.tone}`}>{gpsLabel.text}</p>
                  {gpsState === "active" && (
                    <p className="text-xs text-slate-500">
                      Last fix {fixAgeSec}s ago
                      {Number.isFinite(pos?.accuracy) ? ` · ±${Math.round(pos.accuracy)} m` : ""}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Server link</p>
                  <p className={`mt-1 font-bold ${socketState === "connected" ? "text-emerald-700" : "text-amber-700"}`}>
                    {!trip ? "—" : socketState === "connected" ? "Connected" : socketState === "connecting" ? "Connecting…" : "Reconnecting…"}
                  </p>
                  {trip && socketState !== "connected" && (
                    <p className="text-xs text-slate-500">Students will not see updates until reconnected.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Speed</p>
                  <p className="mt-1 font-bold">
                    {Math.round(pos?.speed || 0)} km/h
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Next stop</p>
                  <p className="mt-1 font-bold">
                    {nextStop?.name || "—"}
                  </p>
                </div>
              </div>
              {trip && (
                <p className="mt-4 text-[11px] leading-snug text-slate-500">
                  Keep this page open and the screen on. Browsers may pause GPS when the app is
                  backgrounded or the phone sleeps, and students then see the bus as offline.
                </p>
              )}
              {gpsError && (
                <div className="mt-4 flex flex-col gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  <div className="flex items-start gap-2">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                    <span>{gpsError}</span>
                  </div>
                  {trip && !testMode && (
                    <button
                      type="button"
                      onClick={() => {
                        hasLoggedGpsFix.current = false;
                        startGpsWatching(bus?._id, trip?._id);
                      }}
                      className="mt-1 w-fit rounded-lg bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-300"
                    >
                      Retry Location Access
                    </button>
                  )}
                </div>
              )}
              {testMode ? (
                testPanel
              ) : !trip ? (
                <button
                  type="button"
                  disabled={tripLoading || !bus}
                  onClick={start}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 font-black text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                >
                  <Navigation size={18} />
                  {tripLoading ? "CHECKING TRIP…" : `START ${shift === "evening" ? "EVENING DROP" : "MORNING PICKUP"}`}
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3.5 font-black text-white hover:bg-red-700"
                >
                  <Square size={17} /> STOP TRIP
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
