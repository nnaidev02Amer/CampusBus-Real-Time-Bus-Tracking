import mongoose from "mongoose";
import BusStop from "../models/BusStop.js";
import Route from "../models/Route.js";
import { computeShiftPath } from "../services/roadRoute.js";

// Accepts { name, latitude, longitude } or null/"" (clears the location).
function normalizePlace(input, label) {
  if (input === null || input === "" || input === undefined) return null;
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (
    typeof input !== "object" ||
    input.latitude === null ||
    input.longitude === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw Object.assign(
      new Error(`${label} needs valid coordinates (latitude -90..90, longitude -180..180).`),
      { status: 400 },
    );
  }
  const name = String(input.name || "").trim().slice(0, 160);
  return { name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, latitude: lat, longitude: lng };
}

// Clients may never write the cached road geometry; the server computes it.
function sanitizeBody(body) {
  const out = { ...body };
  delete out.roadPath;
  delete out.eveningRoadPath;
  if (Object.hasOwn(out, "start")) out.start = normalizePlace(out.start, "Starting location");
  if (Object.hasOwn(out, "destination"))
    out.destination = normalizePlace(out.destination, "Final destination");
  return out;
}

const JOURNEY_FIELDS = ["start", "destination", "stops", "eveningStops"];

// Recomputes OSRM geometry for both shifts. Never throws (routing outages are
// stored as status "unavailable" and the app falls back to straight lines).
export async function refreshRoadPaths(routeId) {
  const doc = await Route.findById(routeId).populate("stops").populate("eveningStops");
  if (!doc) return;
  const route = doc.toObject();
  const [morning, evening] = await Promise.all([
    computeShiftPath(route, "morning"),
    computeShiftPath(route, "evening"),
  ]);
  await Route.updateOne({ _id: routeId }, { $set: { roadPath: morning, eveningRoadPath: evening } });
}

const populated = (query) =>
  query
    .populate("stops")
    .populate("scheduledStops.stopId")
    .populate("eveningStops")
    .populate("eveningScheduledStops.stopId");

async function validateRouteStops(stops) {
  if (!Array.isArray(stops)) {
    throw Object.assign(new Error("Route stops must be an ordered list."), {
      status: 400,
    });
  }
  if (!stops.length) return [];
  if (stops.some((stopId) => !mongoose.isValidObjectId(stopId))) {
    throw Object.assign(new Error("One or more route stop IDs are invalid."), {
      status: 400,
    });
  }
  const ids = stops.map(String);
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error("A route cannot contain the same stop more than once."), {
      status: 400,
    });
  }

  const records = await BusStop.find({ _id: { $in: ids } }).select(
    "_id latitude longitude",
  );
  if (records.length !== ids.length) {
    throw Object.assign(new Error("One or more selected route stops do not exist."), {
      status: 400,
    });
  }
  if (
    records.some(
      (stop) =>
        (stop.latitude != null &&
          (!Number.isFinite(stop.latitude) ||
            stop.latitude < -90 ||
            stop.latitude > 90)) ||
        (stop.longitude != null &&
          (!Number.isFinite(stop.longitude) ||
            stop.longitude < -180 ||
            stop.longitude > 180)),
    )
  ) {
    throw Object.assign(
      new Error(
        "Coordinates must be valid numbers (latitude: -90..90, longitude: -180..180).",
      ),
      { status: 400 },
    );
  }
  const recordsById = new Map(records.map((stop) => [String(stop._id), stop]));
  return ids.map((id) => recordsById.get(id)._id);
}
export async function list(req, res, next) {
  try {
    const routes = await Route.find()
      .populate("stops")
      .populate("scheduledStops.stopId")
      .populate("eveningStops")
      .populate("eveningScheduledStops.stopId");
    res.json({ routes });
  } catch (e) {
    next(e);
  }
}
export async function get(req, res, next) {
  try {
    const route = await Route.findById(req.params.id)
      .populate("stops")
      .populate("scheduledStops.stopId")
      .populate("eveningStops")
      .populate("eveningScheduledStops.stopId");
    if (!route) return res.status(404).json({ message: "Route not found" });
    res.json({ route });
  } catch (e) {
    next(e);
  }
}
export async function create(req, res, next) {
  try {
    const body = sanitizeBody(req.body || {});
    const stops = await validateRouteStops(body.stops || []);
    const eveningStops = body.eveningStops ? await validateRouteStops(body.eveningStops) : [];
    let route = await Route.create({ ...body, stops, eveningStops });
    await refreshRoadPaths(route._id);
    route = await populated(Route.findById(route._id));
    res.status(201).json({ route });
  } catch (e) {
    next(e);
  }
}
export async function update(req, res, next) {
  try {
    const body = sanitizeBody(req.body || {});
    const updates = { ...body };
    if (Object.hasOwn(body, "stops")) {
      updates.stops = await validateRouteStops(body.stops);
    }
    if (Object.hasOwn(body, "eveningStops")) {
      updates.eveningStops = await validateRouteStops(body.eveningStops);
    }
    if (Object.hasOwn(body, "eveningScheduledStops")) {
      updates.eveningScheduledStops = body.eveningScheduledStops;
    }
    const updated = await Route.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ message: "Route not found" });
    if (JOURNEY_FIELDS.some((k) => Object.hasOwn(body, k))) await refreshRoadPaths(updated._id);
    const route = await populated(Route.findById(updated._id));
    res.json({ route });
  } catch (e) {
    next(e);
  }
}
export async function recalculate(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ message: "Route not found" });
    if (!(await Route.exists({ _id: req.params.id })))
      return res.status(404).json({ message: "Route not found" });
    await refreshRoadPaths(req.params.id);
    const route = await populated(Route.findById(req.params.id));
    res.json({ route });
  } catch (e) {
    next(e);
  }
}
export async function remove(req, res, next) {
  try {
    await Route.findByIdAndDelete(req.params.id);
    res.json({ message: "Route deleted" });
  } catch (e) {
    next(e);
  }
}
