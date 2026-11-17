import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
  "trip_started",
  "bus_approaching",
  "bus_arrived",
  "trip_ended",
  "signal_lost",
  "gps_restored",
];

const schema = new mongoose.Schema({
  // Recipient. Every query is scoped to this so students only ever see their own.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus" },
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip" },
  stopId: { type: mongoose.Schema.Types.ObjectId, ref: "BusStop" },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  // e.g. "bus_arrived:<tripId>:<stopId>". The unique index below makes a
  // repeated GPS update unable to create the same notification twice.
  dedupeKey: { type: String, required: true },
  readAt: Date,
  createdAt: { type: Date, default: Date.now },
});
schema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1 });
// Notifications are short-lived; MongoDB removes them after 30 days.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("Notification", schema);
