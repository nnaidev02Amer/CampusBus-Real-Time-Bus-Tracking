import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { reversePlace, searchPlaces } from "../services/geocode.js";

const r = Router();
r.use(requireAuth, requireRole("admin"));

r.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3 || q.length > 200)
    return res.status(400).json({ message: "Enter at least 3 characters to search." });
  try {
    res.json({ results: await searchPlaces(q) });
  } catch (err) {
    console.warn("[geocode] search failed:", err.message);
    res.status(502).json({ message: "Address search is unavailable right now. You can still pick the location on the map." });
  }
});

r.get("/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ message: "Invalid coordinates." });
  try {
    res.json(await reversePlace(lat, lng));
  } catch (err) {
    console.warn("[geocode] reverse failed:", err.message);
    // Not fatal: the caller falls back to a "Pinned location" label.
    res.json({ name: null, latitude: lat, longitude: lng });
  }
});

export default r;
