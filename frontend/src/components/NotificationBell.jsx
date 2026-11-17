import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  BusFront,
  CheckCheck,
  Flag,
  MapPin,
  Play,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";

const TYPE_STYLE = {
  trip_started: { Icon: Play, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" },
  bus_approaching: { Icon: BusFront, tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" },
  bus_arrived: { Icon: MapPin, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" },
  trip_ended: { Icon: Flag, tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  signal_lost: { Icon: WifiOff, tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300" },
  gps_restored: { Icon: Wifi, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" },
};

function timeAgo(iso, now) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell() {
  const { items, unreadCount, loading, error, reload, markRead, markAllRead, remove, clearAll } =
    useNotifications(true);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(tick);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="notification-bell"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 active:scale-95 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1.5 -top-1.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white dark:ring-slate-950"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-panel"
          className="fixed inset-x-3 top-16 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">Notifications</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {unreadCount ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAllRead}
                disabled={!unreadCount}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={!items.length}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                <Trash2 size={14} /> Clear all
              </button>
            </div>
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto">
            {loading && !items.length ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex animate-pulse gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error && !items.length ? (
              <div className="p-6 text-center text-sm">
                <p className="font-semibold text-red-700 dark:text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={reload}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 dark:bg-blue-600"
                >
                  Try again
                </button>
              </div>
            ) : !items.length ? (
              <div data-testid="notification-empty" className="grid place-items-center gap-2 p-8 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                  <BellOff size={20} />
                </span>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No notifications yet</p>
                <p className="max-w-[16rem] text-xs text-slate-500 dark:text-slate-400">
                  You will be notified here when your bus starts or ends a trip, approaches or reaches your stop,
                  or loses its GPS signal.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((n) => {
                  const { Icon, tone } = TYPE_STYLE[n.type] || TYPE_STYLE.trip_ended;
                  const unread = !n.readAt;
                  return (
                    <li
                      key={n.id}
                      data-testid="notification-item"
                      data-type={n.type}
                      data-unread={unread}
                      className={`group relative flex gap-3 px-4 py-3 ${unread ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
                    >
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}>
                        <Icon size={16} />
                      </span>
                      <button
                        type="button"
                        onClick={() => unread && markRead(n.id)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`${n.title}. ${n.message}${unread ? " Mark as read" : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{n.title}</span>
                          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-hidden="true" />}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-300">{n.message}</span>
                        <time
                          dateTime={n.createdAt}
                          title={new Date(n.createdAt).toLocaleString()}
                          className="mt-1 block text-[11px] text-slate-400"
                        >
                          {timeAgo(n.createdAt, now)}
                        </time>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(n.id)}
                        aria-label="Dismiss notification"
                        className="h-7 w-7 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <X size={14} className="mx-auto" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
