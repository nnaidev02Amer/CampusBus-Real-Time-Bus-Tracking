import Bus from "../models/Bus.js";
import BusStop from "../models/BusStop.js";
import Notification from "../models/Notification.js";
import Trip from "../models/Trip.js";
import User from "../models/User.js";
import { clearPathProgress } from "./pathProgress.js";

const APPROACH_MINUTES = Number(process.env.NOTIFY_APPROACH_MINUTES) || 5;
const STALE_MS = Number(process.env.LOCATION_STALE_MS || 120000);
const SIGNAL_CHECK_MS = Number(process.env.SIGNAL_CHECK_MS || 15000);

// Fast path so repeated GPS updates do not even hit the database. The unique
// (userId, dedupeKey) index remains the real guarantee (it survives restarts).
const handled = new Set();

export function serializeNotification(n) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    message: n.message,
    busId: n.busId ? String(n.busId) : null,
    tripId: n.tripId ? String(n.tripId) : null,
    stopId: n.stopId ? String(n.stopId) : null,
    createdAt: n.createdAt,
    readAt: n.readAt || null,
  };
}

async function createFor(io, recipients, base) {
  for (const user of recipients) {
    try {
      const { dedupeKey, ...rest } = base;
      const res = await Notification.updateOne(
        { userId: user._id, dedupeKey },
        { $setOnInsert: { ...rest, createdAt: new Date() } },
        { upsert: true },
      );
      if (res.upsertedId) {
        const doc = await Notification.findById(res.upsertedId);
        // Private per-user room: only that student's sockets receive it.
        io?.to(`user:${user._id}`).emit("notification:new", serializeNotification(doc));
      }
    } catch (err) {
      if (err?.code !== 11000) console.warn("[notifications] create failed:", err.message);
    }
  }
}

// Only students assigned to this bus (optionally to a specific stop).
function studentsOf(busId, stopId) {
  return User.find({
    role: "student",
    isActive: { $ne: false },
    assignedBusId: busId,
    ...(stopId ? { assignedStop: stopId } : {}),
  }).select("_id");
}

async function busName(busId) {
  const bus = await Bus.findById(busId).select("busNumber");
  return bus?.busNumber || "Your bus";
}

export async function notifyTripStarted(io, bus, trip) {
  try {
    const students = await studentsOf(bus._id);
    await createFor(io, students, {
      busId: bus._id,
      tripId: trip._id,
      type: "trip_started",
      title: "Trip started",
      message: `${bus.busNumber} has started its ${trip.shift} trip.${trip.isTest ? " (Test mode - simulated GPS)" : ""}`,
      dedupeKey: `trip_started:${trip._id}`,
    });
  } catch (err) {
    console.warn("[notifications] trip start:", err.message);
  }
}

export async function notifyTripEnded(io, trip) {
  try {
    for (const key of handled) if (key.startsWith(`${trip._id}:`)) handled.delete(key);
    clearPathProgress(trip._id);
    const students = await studentsOf(trip.busId);
    await createFor(io, students, {
      busId: trip.busId,
      tripId: trip._id,
      type: "trip_ended",
      title: "Trip ended",
      message: `${await busName(trip.busId)} has ended its trip.`,
      dedupeKey: `trip_ended:${trip._id}`,
    });
  } catch (err) {
    console.warn("[notifications] trip end:", err.message);
  }
}

// Called after every accepted location update. Only STATE CHANGES create
// notifications, so heartbeats and repeated fixes are silent.
export async function handleLocationNotifications(io, data) {
  try {
    const { busId, tripId } = data;
    const name = await busName(busId);

    if (data.signalWasLost) {
      const t = await Trip.findOneAndUpdate(
        { _id: tripId, signalLost: true },
        { $set: { signalLost: false } },
        { new: true },
      );
      if (t) {
        await createFor(io, await studentsOf(busId), {
          busId,
          tripId,
          type: "gps_restored",
          title: "GPS restored",
          message: `Live tracking for ${name} has resumed.`,
          dedupeKey: `gps_restored:${tripId}:${t.signalLostCount}`,
        });
      }
    }

    if (data.newArrival) {
      const { stopId, stopName } = data.newArrival;
      await createFor(io, await studentsOf(busId, stopId), {
        busId,
        tripId,
        stopId,
        type: "bus_arrived",
        title: "Bus arrived",
        message: `${name} has arrived at ${stopName}.`,
        dedupeKey: `bus_arrived:${tripId}:${stopId}`,
      });
    }

    const arrived = new Set((data.stopArrivals || []).map((a) => String(a.stopId)));
    const due = Object.entries(data.etaByStop || {}).filter(
      ([stopId, eta]) =>
        eta?.minutes <= APPROACH_MINUTES &&
        !arrived.has(stopId) &&
        !handled.has(`${tripId}:${stopId}`),
    );
    if (due.length) {
      due.forEach(([stopId]) => handled.add(`${tripId}:${stopId}`));
      for (const [stopId, eta] of due) {
        const students = await studentsOf(busId, stopId);
        if (!students.length) continue;
        const stop = await BusStop.findById(stopId).select("name");
        await createFor(io, students, {
          busId,
          tripId,
          stopId,
          type: "bus_approaching",
          title: "Bus approaching",
          message: `${name} is about ${eta.minutes} min away from ${stop?.name || "your stop"}.`,
          dedupeKey: `bus_approaching:${tripId}:${stopId}`,
        });
      }
    }
  } catch (err) {
    console.warn("[notifications] location:", err.message);
  }
}

// Detects "no GPS for a while" (there is no event when updates simply stop).
export function startSignalMonitor(io) {
  const tick = async () => {
    try {
      const cutoff = Date.now() - STALE_MS;
      const trips = await Trip.find({ status: "active", signalLost: { $ne: true } }).select(
        "_id busId startedAt",
      );
      for (const trip of trips) {
        const bus = await Bus.findById(trip.busId).select("busNumber currentLocation lastUpdated");
        const last = bus?.currentLocation?.receivedAt || bus?.lastUpdated || trip.startedAt;
        if (!last || new Date(last).getTime() > cutoff) continue;
        const flagged = await Trip.findOneAndUpdate(
          { _id: trip._id, status: "active", signalLost: { $ne: true } },
          { $set: { signalLost: true }, $inc: { signalLostCount: 1 } },
          { new: true },
        );
        if (!flagged) continue;
        await createFor(io, await studentsOf(trip.busId), {
          busId: trip.busId,
          tripId: trip._id,
          type: "signal_lost",
          title: "Signal lost",
          message: `Live location for ${bus?.busNumber || "your bus"} is unavailable. It will resume when GPS reconnects.`,
          dedupeKey: `signal_lost:${trip._id}:${flagged.signalLostCount}`,
        });
      }
    } catch (err) {
      console.warn("[notifications] signal monitor:", err.message);
    }
  };
  const timer = setInterval(tick, SIGNAL_CHECK_MS);
  timer.unref?.();
  return timer;
}
