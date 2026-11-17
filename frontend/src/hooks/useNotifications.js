import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, notificationApi } from "../services/api";

const MAX_ITEMS = 100;

function latestToken() {
  let t =
    localStorage.getItem("campusbus_token") ||
    sessionStorage.getItem("campusbus_token") ||
    "";
  if (typeof t === "string" && t.startsWith("Bearer ")) t = t.slice(7).trim();
  return t;
}

// Native OS notification, only if the student already allowed them. "Approaching"
// is skipped because the dashboard's existing "Stop alerts" already covers it.
function nativeNotify(n) {
  try {
    if (
      "Notification" in window &&
      Notification.permission === "granted" &&
      n.type !== "bus_approaching"
    ) {
      new Notification(n.title, { body: n.message });
    }
  } catch {
    /* not supported / blocked */
  }
}

// Persisted notifications (REST) + live delivery (Socket.IO "notification:new").
export function useNotifications(enabled = true) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasConnected = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await notificationApi.list();
      setItems(res.data.notifications || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      auth: (cb) => cb({ token: latestToken() }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on("connect", () => {
      // After a reconnect, re-sync so nothing sent while offline is missed.
      if (hasConnected.current) load();
      hasConnected.current = true;
    });
    socket.on("notification:new", (n) => {
      let added = false;
      setItems((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        added = true;
        return [n, ...prev].slice(0, MAX_ITEMS);
      });
      if (added) nativeNotify(n);
    });
    return () => {
      hasConnected.current = false;
      socket.disconnect();
    };
  }, [enabled, load]);

  const unreadCount = items.filter((n) => !n.readAt).length;

  const markRead = useCallback(
    async (id) => {
      setItems((prev) =>
        prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      try {
        await notificationApi.markRead(id);
      } catch {
        load();
      }
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    try {
      await notificationApi.markAllRead();
    } catch {
      load();
    }
  }, [load]);

  const remove = useCallback(
    async (id) => {
      setItems((prev) => prev.filter((n) => n.id !== id));
      try {
        await notificationApi.remove(id);
      } catch {
        load();
      }
    },
    [load],
  );

  const clearAll = useCallback(async () => {
    setItems([]);
    try {
      await notificationApi.clear();
    } catch {
      load();
    }
  }, [load]);

  return { items, unreadCount, loading, error, reload: load, markRead, markAllRead, remove, clearAll };
}
