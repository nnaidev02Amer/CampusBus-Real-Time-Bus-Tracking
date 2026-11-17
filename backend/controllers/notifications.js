import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import { serializeNotification } from "../services/notifications.js";

// Every query is scoped to req.user._id: a student can never read or change
// another user's notifications (a foreign id behaves exactly like "not found").
const mine = (req) => ({ userId: req.user._id });

export async function list(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const [items, unreadCount] = await Promise.all([
      Notification.find(mine(req)).sort({ createdAt: -1 }).limit(limit),
      Notification.countDocuments({ ...mine(req), readAt: { $exists: false } }),
    ]);
    res.json({ notifications: items.map(serializeNotification), unreadCount });
  } catch (e) {
    next(e);
  }
}

export async function markRead(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ message: "Notification not found" });
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...mine(req) },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) return res.status(404).json({ message: "Notification not found" });
    res.json({ notification: serializeNotification(n) });
  } catch (e) {
    next(e);
  }
}

export async function markAllRead(req, res, next) {
  try {
    await Notification.updateMany(
      { ...mine(req), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    res.json({ unreadCount: 0 });
  } catch (e) {
    next(e);
  }
}

export async function remove(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ message: "Notification not found" });
    const r = await Notification.deleteOne({ _id: req.params.id, ...mine(req) });
    if (!r.deletedCount) return res.status(404).json({ message: "Notification not found" });
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
}

export async function clearAll(req, res, next) {
  try {
    const r = await Notification.deleteMany(mine(req));
    res.json({ deleted: r.deletedCount });
  } catch (e) {
    next(e);
  }
}
