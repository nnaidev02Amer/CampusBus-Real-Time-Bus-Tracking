import mongoose from "mongoose";

// A named map location (journey start / final destination).
const placeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 160 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

// Cached road-following geometry from OSRM. Computed server-side when a route's
// journey changes, so students never depend on the routing service being up.
const roadPathSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["ok", "unavailable"], required: true },
    coordinates: { type: [[Number]], default: undefined }, // [lat, lng] pairs
    distanceMeters: Number,
    durationSeconds: Number,
    provider: String,
    error: String,
    computedAt: Date,
  },
  { _id: false },
);

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  routeNumber: { type: String, trim: true },
  direction: { type: String, trim: true },
  effectiveFrom: { type: String, trim: true },
  busRegistration: { type: String, trim: true },
  driverName: { type: String, trim: true },
  driverMobile: { type: String, trim: true },
  busInCharge: { type: String, trim: true },
  instructions: [{ type: String, trim: true }],
  start: { type: placeSchema, default: null },
  destination: { type: placeSchema, default: null },
  roadPath: { type: roadPathSchema, default: null },
  eveningRoadPath: { type: roadPathSchema, default: null },
  scheduledStops: [{
    place: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },
    stopId: { type: mongoose.Schema.Types.ObjectId, ref: "BusStop", default: null },
  }],
  stops: [{ type: mongoose.Schema.Types.ObjectId, ref: "BusStop" }],
  eveningScheduledStops: [{
    place: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },
    stopId: { type: mongoose.Schema.Types.ObjectId, ref: "BusStop", default: null },
  }],
  eveningStops: [{ type: mongoose.Schema.Types.ObjectId, ref: "BusStop" }],
  createdAt: { type: Date, default: Date.now },
});
export default mongoose.model("Route", schema);
