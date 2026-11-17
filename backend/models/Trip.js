import mongoose from "mongoose";
const schema = new mongoose.Schema({
  busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", required: true },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  routeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Route",
    // Prototype test trips may run on a bus that has no route assigned.
    required: function () {
      return !this.isTest;
    },
  },
  // true => simulated "test mode" trip started by a driver; only simulated
  // locations are accepted for it and real GPS is rejected.
  isTest: { type: Boolean, default: false },
  // GPS-health state used to notify students only when it CHANGES (not on every update).
  signalLost: { type: Boolean, default: false },
  signalLostCount: { type: Number, default: 0 },
  shift: { type: String, enum: ["morning", "evening"], default: "morning" },
  status: { type: String, enum: ["active", "ended"], default: "active" },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  stopArrivals: [
    {
      stopId: { type: mongoose.Schema.Types.ObjectId, ref: "BusStop" },
      stopName: { type: String, trim: true },
      arrivedAt: { type: Date, default: Date.now },
      delayMinutes: { type: Number, default: 0 },
    },
  ],
});
export default mongoose.model("Trip", schema);
