import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { processLocation } from "../services/location.js";
import Bus from "../models/Bus.js";
import { verifyFirebaseToken } from "../services/firebaseAuth.js";
import { isTestModeEnabled } from "../services/testMode.js";
import { handleLocationNotifications } from "../services/notifications.js";

// Location events for one bus are handled strictly in arrival order. Without
// this, a slow DB round-trip lets an older fix finish after a newer one and
// overwrite it, making the student's marker jump backwards.
const busQueues = new Map();
function serial(handler) {
  return (payload) => {
    const key = String(payload?.busId ?? "");
    const prev = busQueues.get(key) || Promise.resolve();
    const next = prev.then(() => handler(payload)).catch(() => {});
    busQueues.set(key, next);
    next.then(() => {
      if (busQueues.get(key) === next) busQueues.delete(key);
    });
    return next;
  };
}

export function setupSockets(io) {
  io.use(async (socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.auth?.Authorization;
      if (!raw) return next(new Error("Authentication required"));
      const token =
        typeof raw === "string" && raw.startsWith("Bearer ")
          ? raw.slice(7).trim()
          : typeof raw === "string"
            ? raw.trim()
            : raw;
      if (!token) return next(new Error("Authentication required"));

      let user = null;
      // 1. Try backend JWT verification
      try {
        const p = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(p.id);
      } catch (jwtErr) {
        // 2. Fallback: try Firebase ID token verification
        try {
          const decoded = await verifyFirebaseToken(token);
          if (decoded?.uid) {
            user = await User.findOne({ firebaseUid: decoded.uid });
            if (!user && decoded.email) {
              user = await User.findOne({ email: decoded.email.trim().toLowerCase() });
            }
          }
        } catch (fbErr) {
          console.warn("[Socket Auth] Handshake token verification failed:", {
            jwtError: jwtErr.message,
            fbError: fbErr.message,
          });
        }
      }

      if (!user) {
        return next(new Error("Invalid token"));
      }
      if (user.isActive === false) {
        return next(new Error("User not found or account deactivated"));
      }
      socket.user = user;
      next();
    } catch (err) {
      console.error("[Socket Auth Handshake Error]", err);
      next(new Error("Invalid token"));
    }
  });
  io.on("connection", (socket) => {
    // Private room for per-user events (notifications). Only this user joins it.
    socket.join(`user:${socket.user._id}`);
    socket.on("student:track-bus", async ({ busId }) => {
      if (socket.user.role !== "student") return;
      socket.join(`bus:${busId}`);
    });
    socket.on("student:untrack-bus", ({ busId }) =>
      socket.leave(`bus:${busId}`),
    );
    socket.on("driver:location", serial(async (payload) => {
      try {
        if (socket.user.role !== "driver") return;
        if (!payload || typeof payload !== "object")
          return socket.emit("location:error", { message: "Invalid location payload" });
        const driver = await User.findById(socket.user._id).select("role isActive");
        if (!driver || driver.isActive === false) {
          socket.emit("location:error", { message: "Driver account is deactivated." });
          socket.disconnect(true);
          return;
        }
        const bus = await Bus.findById(payload.busId);
        if (!bus || String(bus.driverId) !== String(driver._id))
          return socket.emit("location:error", {
            message: "Not assigned to this bus",
          });
        const data = await processLocation(payload, "driver-gps");
        io.to(`bus:${payload.busId}`).emit("bus:location", data);
        await handleLocationNotifications(io, data);
        socket.emit("location:accepted", {
          timestamp: data.timestamp,
          stopArrivals: data.stopArrivals || [],
          nextStop: data.nextStop || null,
        });
      } catch (e) {
        socket.emit("location:error", { message: e.message });
      }
    }));
    // Prototype "test mode": an assigned driver streams SIMULATED positions for
    // their own test-mode trip. Always tagged source=simulator, never driver-gps.
    socket.on("driver:test-location", serial(async (payload) => {
      try {
        if (socket.user.role !== "driver") return;
        if (!isTestModeEnabled())
          return socket.emit("location:error", { message: "Test mode is disabled on this server." });
        if (!payload || typeof payload !== "object")
          return socket.emit("location:error", { message: "Invalid location payload" });
        const driver = await User.findById(socket.user._id).select("role isActive");
        if (!driver || driver.isActive === false) {
          socket.emit("location:error", { message: "Driver account is deactivated." });
          socket.disconnect(true);
          return;
        }
        const bus = await Bus.findById(payload.busId);
        if (!bus || String(bus.driverId) !== String(driver._id))
          return socket.emit("location:error", { message: "Not assigned to this bus" });
        const data = await processLocation(payload, "simulator", { requireTestTrip: true });
        io.to(`bus:${payload.busId}`).emit("bus:location", data);
        await handleLocationNotifications(io, data);
        socket.emit("location:accepted", {
          timestamp: data.timestamp,
          stopArrivals: data.stopArrivals || [],
          nextStop: data.nextStop || null,
        });
      } catch (e) {
        socket.emit("location:error", { message: e.message });
      }
    }));
    socket.on("simulator:location", serial(async (payload) => {
      try {
        if (socket.user.role !== "admin") return;
        const data = await processLocation(payload, "simulator");
        io.to(`bus:${payload.busId}`).emit("bus:location", data);
        await handleLocationNotifications(io, data);
      } catch (e) {
        socket.emit("location:error", { message: e.message });
      }
    }));
    socket.on("disconnect", () => {});
  });
}
