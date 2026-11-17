import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BusFront, MapPinned, PlayCircle, Radio, Route as RouteIcon } from "lucide-react";
import Layout from "../components/Layout";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import { ErrorState, EmptyState, Skeleton, apiMessage } from "../components/PageState";
import { busApi, routeApi, tripApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";

export default function DriverDashboard() {
  const { user } = useAuth();
  const [bus, setBus] = useState(null);
  const [route, setRoute] = useState(null);
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      const buses = (await busApi.list()).data.buses;
      const mine = buses.find(
        (b) => String(b.driverId?._id || b.driverId) === String(user.id),
      );
      const routeId = mine?.routeId?._id || mine?.routeId;
      const [routeRes, tripsRes] = await Promise.all([
        routeId ? routeApi.get(routeId) : Promise.resolve(null),
        tripApi.active(),
      ]);
      if (cancelled) return;
      setBus(mine || null);
      setRoute(routeRes?.data?.route || null);
      setTrip(
        tripsRes.data.trips.find(
          (t) => String(t.driverId?._id || t.driverId) === String(user.id),
        ) || null,
      );
    })()
      .catch((e) => !cancelled && setError(apiMessage(e, "Could not load your dashboard.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user.id, reloadKey]);

  const stops = route?.stops || [];

  return (
    <Layout>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
            Driver console
          </p>
          <h1 className="mt-1 text-3xl font-black">Hello, {user.name?.split(" ")[0] || "Driver"}</h1>
        </div>

        {loading && <Skeleton rows={3} />}
        {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

        {!loading && !error && !bus && (
          <EmptyState
            title="No bus assigned to you yet"
            hint="Ask an administrator to assign a bus to your account."
          />
        )}

        {!loading && !error && bus && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Assigned bus" value={bus.busNumber} icon={BusFront} tone="blue" sub={bus.registrationNumber} />
              <StatCard label="Route" value={route?.routeNumber ? `No. ${route.routeNumber}` : route?.name || "—"} icon={RouteIcon} sub={route?.direction} />
              <StatCard label="Stops" value={stops.length} icon={MapPinned} />
              <StatCard
                label="Trip status"
                value={trip ? "Active" : "Not started"}
                icon={Radio}
                tone={trip ? "green" : "amber"}
                sub={trip ? `${trip.shift} shift` : undefined}
              />
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-black">{trip ? "Your trip is running" : "Ready to drive?"}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {trip
                      ? "Open the trip page to see the map or end the trip."
                      : "Start a trip from the trip page. Your device GPS is shared live with students tracking your bus."}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={trip ? "active" : "no_active_trip"} />
                  <Link
                    to="/driver/trip"
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-blue-600"
                  >
                    <PlayCircle size={16} /> {trip ? "Open trip" : "Go to trip"}
                  </Link>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-black">Route stops</h2>
              {stops.length ? (
                <ol className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {stops.map((s, i) => (
                    <li key={s._id || i} className="flex items-center gap-3 py-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800">
                        {i + 1}
                      </span>
                      <span className="font-semibold">{s.name}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  {route ? "No stops have been added to this route yet." : "No route is assigned to your bus yet."}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
