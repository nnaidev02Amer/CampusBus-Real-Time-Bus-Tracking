import { AlertTriangle, Flag, Navigation, Route as RouteIcon } from "lucide-react";
import { formatDistance, formatDuration, journeyForShift, remainingAlongPath } from "../utils/routePath";

// Start -> stops -> destination overview with road distance / duration, and (when
// the bus is live) the next stop and distance remaining along the road.
export default function JourneySummary({ route, shift = "morning", live = null, nextStopName = "", className = "" }) {
  const j = journeyForShift(route, shift);
  if (!j.start && !j.destination && !j.path) return null;

  const progress = live && j.path ? remainingAlongPath(j.path.coordinates, live) : null;
  const onRoute = progress && progress.offRouteMeters <= 1000;
  const remainingSeconds =
    onRoute && j.path.distanceMeters
      ? Math.round(j.path.durationSeconds * (progress.remainingMeters / progress.totalMeters))
      : null;
  const next = live ? nextStopName || (j.destination ? `Destination - ${j.destination.name}` : "") : "";

  return (
    <section
      data-testid="journey-summary"
      aria-label="Route journey"
      className={`border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-800/30 sm:px-5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {j.start && (
          <span className="flex min-w-0 items-center gap-1.5" data-testid="journey-start">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-[10px] font-black text-white">S</span>
            <span className="truncate font-bold text-slate-800 dark:text-slate-100">{j.start.name}</span>
          </span>
        )}
        <span className="font-semibold text-slate-400">
          {j.start ? "→ " : ""}{j.stops.length} stop{j.stops.length === 1 ? "" : "s"}{j.destination ? " →" : ""}
        </span>
        {j.destination && (
          <span className="flex min-w-0 items-center gap-1.5" data-testid="journey-destination">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-600 text-white">
              <Flag size={11} />
            </span>
            <span className="truncate font-bold text-slate-800 dark:text-slate-100">{j.destination.name}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
        {j.path ? (
          <span className="flex items-center gap-1.5" data-testid="journey-stats">
            <RouteIcon size={13} className="text-blue-600" />
            <strong>{formatDistance(j.path.distanceMeters)}</strong>
            <span>· est. drive {formatDuration(j.path.durationSeconds)}</span>
          </span>
        ) : null}
        {onRoute && (
          <span data-testid="journey-remaining">
            Remaining <strong>{formatDistance(progress.remainingMeters)}</strong>
            {remainingSeconds != null && <> · ~{formatDuration(remainingSeconds)} to destination</>}
          </span>
        )}
        {next && (
          <span className="flex items-center gap-1.5" data-testid="journey-next">
            <Navigation size={13} className="text-blue-600" />
            Next: <strong>{next}</strong>
          </span>
        )}
      </div>

      {j.pathStatus !== "ok" && (j.start || j.destination) && (
        <p
          data-testid="journey-fallback"
          className="mt-2 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle size={13} />
          {j.pathStatus === "unavailable"
            ? "Road route is temporarily unavailable - showing straight lines between locations."
            : "Road route not calculated yet - showing straight lines between locations."}
        </p>
      )}
    </section>
  );
}
