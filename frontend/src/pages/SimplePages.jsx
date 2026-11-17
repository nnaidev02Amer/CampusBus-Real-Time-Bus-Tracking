import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import Layout from "../components/Layout";
import { Link } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import { busApi, routeApi } from "../services/api";
export { AdminDashboard, AdminBuses, AdminRoutes, AdminStops, AdminTrips } from "./AdminOperations";
export { AdminUsers } from "./AdminUsers";
export function StudentBuses() {
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    busApi
      .list()
      .then((r) => !cancelled && setBuses(r.data.buses))
      .catch(
        (err) =>
          !cancelled &&
          setError(err.response?.data?.message || "Could not load buses. Check that the backend is running."),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <Layout>
      <div className="space-y-5">
        <div>
          <h1 className="text-3xl font-black">Buses</h1>
          <p className="mt-1 text-sm text-slate-500">
            All campus buses. Open a bus to track it live on your dashboard.
          </p>
        </div>

        {loading && <p className="text-sm text-slate-500">Loading buses…</p>}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}{" "}
            <button type="button" className="font-bold underline" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && !buses.length && (
          <p className="text-sm text-slate-500">No buses available yet.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {buses.map((bus) => (
            <section
              key={bus._id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-black">{bus.busNumber}</h2>
                  <p className="text-xs text-slate-500">{bus.registrationNumber}</p>
                </div>
                <StatusBadge status={bus.status} />
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Route</dt>
                  <dd className="text-right font-semibold">
                    {bus.routeId?.direction || bus.routeId?.name || "Not assigned"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Driver</dt>
                  <dd className="text-right font-semibold">{bus.driverId?.name || "Not assigned"}</dd>
                </div>
              </dl>
              <div className="mt-4 flex items-center justify-between">
                <Link
                  to={`/student/dashboard?bus=${bus._id}`}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-blue-600"
                >
                  Track this bus
                </Link>
                {String(user?.assignedBusId) === String(bus._id) && (
                  <span className="text-xs font-bold text-blue-700 dark:text-blue-400">Your bus</span>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Layout>
  );
}
const fmt12h = (timeStr) => {
  if (!timeStr) return "";
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([aApP][mM]))?$/);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = match[3];
  if (ampm) return `${h}:${m} ${ampm.toUpperCase()}`;
  const suffix = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
};

export function StudentRoutes() {
  const [routes, setRoutes] = useState([]);
  const [shift, setShift] = useState("morning");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    routeApi
      .list()
      .then((r) => !cancelled && setRoutes(r.data.routes))
      .catch(
        (err) =>
          !cancelled &&
          setError(err.response?.data?.message || "Could not load routes. Check that the backend is running."),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">Routes & Schedules</h1>
            <p className="mt-1 text-sm text-slate-500">
              Official college bus timetables for morning pickup and evening return drops.
            </p>
          </div>

          {/* Shift Selector */}
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 self-start sm:self-auto" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={shift === "morning"}
              onClick={() => setShift("morning")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                shift === "morning"
                  ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              ☀️ Morning Pickup
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shift === "evening"}
              onClick={() => setShift("evening")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                shift === "evening"
                  ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              🌙 Evening Drop (3:30 PM)
            </button>
          </div>
        </div>

        {routes.map((route) => {
          const isEvening = shift === "evening";
          const stopsToShow = isEvening
            ? (route.eveningScheduledStops?.length ? route.eveningScheduledStops : [])
            : (route.scheduledStops || []);

          return (
            <section
              key={route._id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-blue-100 dark:bg-blue-900/60 px-2.5 py-1 text-xs font-black uppercase text-blue-800 dark:text-blue-300">
                      {route.routeNumber ? `Bus No. ${route.routeNumber}` : "Route"}
                    </span>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">
                      {route.direction || route.name}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 font-medium">
                    {isEvening
                      ? "Evening Student Drop Schedule · Departs College at 3:30 PM"
                      : "Morning Student Pickup Schedule · Arrives College at 8:55 AM"}
                    {route.busRegistration ? ` · Reg: ${route.busRegistration}` : ""}
                    {route.effectiveFrom ? ` · Effective: ${route.effectiveFrom}` : ""}
                  </p>
                </div>

                <span className={`rounded-full px-3 py-1 text-xs font-bold border ${
                  isEvening
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                }`}>
                  {isEvening ? "Evening Return" : "Morning Pickup"}
                </span>
              </div>

              {stopsToShow.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b bg-slate-50 dark:bg-slate-800/60 text-xs uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="p-3">S. No.</th>
                          <th className="p-3">Stop / Place</th>
                          <th className="p-3">Scheduled Time</th>
                          <th className="p-3">12-Hour Format</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {stopsToShow.map((stop, i) => (
                          <tr
                            key={`${stop.place}-${i}`}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                          >
                            <td className="p-3 font-bold text-slate-400">{i + 1}</td>
                            <td className="p-3 font-bold text-slate-800 dark:text-slate-200">{stop.place}</td>
                            <td className="p-3 tabular-nums font-mono font-bold text-blue-700 dark:text-blue-400">{stop.time}</td>
                            <td className="p-3 tabular-nums text-xs font-medium text-slate-500">{fmt12h(stop.time)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3 pt-2">
                    {route.driverName && (
                      <p>
                        <strong className="text-slate-800 dark:text-slate-200">Driver:</strong> {route.driverName}{" "}
                        {route.driverMobile ? `(${route.driverMobile})` : ""}
                      </p>
                    )}
                    {route.busInCharge && (
                      <p>
                        <strong className="text-slate-800 dark:text-slate-200">Bus In Charge:</strong> {route.busInCharge}
                      </p>
                    )}
                    {route.busRegistration && (
                      <p>
                        <strong className="text-slate-800 dark:text-slate-200">Bus Reg:</strong> {route.busRegistration}
                      </p>
                    )}
                  </div>

                  {route.instructions?.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-3">
                      {route.instructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No stops configured for this shift yet.
                </p>
              )}
            </section>
          );
        })}
        {loading && <p className="text-sm text-slate-500">Loading routes…</p>}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}{" "}
            <button type="button" className="font-bold underline" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && !routes.length && (
          <p className="text-sm text-slate-500">No routes available.</p>
        )}
      </div>
    </Layout>
  );
}
export { default as Profile } from "./Profile";
export { default as DriverDashboard } from "./DriverDashboard";
