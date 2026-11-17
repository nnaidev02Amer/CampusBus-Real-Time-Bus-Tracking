import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { LocateFixed, MapPin, RefreshCw, Save, Search, X } from "lucide-react";
import { geocodeApi, routeApi } from "../services/api";
import { destinationIcon, startIcon, stopNumberIcon } from "./MapView";
import { formatDistance, formatDuration, hasLL } from "../utils/routePath";

const DEFAULT_CENTER = [22.7196, 75.8577];

function ClickToPick({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitTo({ points, focus }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 16, animate: false });
    else if (points.length === 1) map.setView(points[0], 15, { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  useEffect(() => {
    if (focus) map.setView(focus, Math.max(map.getZoom(), 15), { animate: false });
  }, [map, focus?.[0], focus?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function LocationField({ role, label, accent, place, onChange, picking, onTogglePick, onError }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (query.trim().length < 3) {
      onError("Type at least 3 characters to search.");
      return;
    }
    setSearching(true);
    onError("");
    try {
      const res = await geocodeApi.search(query.trim());
      setResults(res.data.results || []);
      setSearched(true);
    } catch (err) {
      setResults([]);
      onError(err.response?.data?.message || "Address search is unavailable. Pick the location on the map instead.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid={`journey-field-${role}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700">
          <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] text-white ${accent}`}>
            {role === "start" ? "S" : "D"}
          </span>
          {label}
        </p>
        {place && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-red-600"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {place ? (
        <>
          <input
            data-testid={`journey-name-${role}`}
            value={place.name || ""}
            onChange={(e) => onChange({ ...place, name: e.target.value })}
            maxLength={160}
            aria-label={`${label} name`}
            className="w-full rounded-lg border px-3 py-2 text-sm font-semibold"
          />
          <p className="text-[11px] text-slate-500" data-testid={`journey-coords-${role}`}>
            {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500">Not set. Search an address or pick a point on the map.</p>
      )}

      <div className="flex gap-2">
        <input
          data-testid={`journey-search-${role}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Search address or place…"
          aria-label={`Search ${label}`}
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="button"
          data-testid={`journey-search-btn-${role}`}
          onClick={search}
          disabled={searching}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          <Search size={14} /> {searching ? "…" : "Search"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border text-xs" data-testid={`journey-results-${role}`}>
          {results.map((r, i) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                data-testid={`journey-result-${role}-${i}`}
                onClick={() => {
                  onChange({ name: r.name, latitude: r.latitude, longitude: r.longitude });
                  setResults([]);
                  setQuery("");
                  setSearched(false);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-blue-50"
              >
                <span className="font-bold text-slate-800">{r.name}</span>
                <span className="block text-[10px] text-slate-400">
                  {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && results.length === 0 && <p className="text-[11px] text-slate-500">No matches. Try a different search or pick on the map.</p>}

      <button
        type="button"
        data-testid={`journey-pick-${role}`}
        onClick={onTogglePick}
        aria-pressed={picking}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${
          picking ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <MapPin size={14} /> {picking ? "Click the map to place it…" : "Pick on map"}
      </button>
    </div>
  );
}

// Start / destination chooser with a live map preview of the journey.
export default function RouteJourneyEditor({ value, onChange, previewStops = [], previewPath = null }) {
  const start = value?.start || null;
  const destination = value?.destination || null;
  const [picking, setPicking] = useState(null); // "start" | "destination" | null
  const [error, setError] = useState("");
  const [focus, setFocus] = useState(null);

  const stopPts = useMemo(() => previewStops.filter(hasLL), [previewStops]);
  const fitPoints = useMemo(
    () =>
      [start, ...stopPts, destination].filter(hasLL).map((p) => [p.latitude, p.longitude]),
    [start, destination, stopPts],
  );
  const road = previewPath?.status === "ok" && previewPath.coordinates?.length > 1 ? previewPath.coordinates : null;

  const set = (role, place) => {
    onChange({ start, destination, [role]: place });
    if (place) setFocus([place.latitude, place.longitude]);
  };

  const pick = async (role, lat, lng) => {
    setPicking(null);
    setError("");
    const pinned = { name: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`, latitude: lat, longitude: lng };
    set(role, pinned); // show immediately, then try to name it
    try {
      const res = await geocodeApi.reverse(lat, lng);
      if (res.data?.name) onChange({ start, destination, [role]: { ...pinned, name: res.data.name } });
    } catch {
      /* keep the pinned label */
    }
  };

  return (
    <div className="space-y-3" data-testid="journey-editor">
      <div className="grid gap-3 md:grid-cols-2">
        <LocationField
          role="start"
          label="Starting location"
          accent="bg-emerald-600"
          place={start}
          onChange={(p) => set("start", p)}
          picking={picking === "start"}
          onTogglePick={() => setPicking(picking === "start" ? null : "start")}
          onError={setError}
        />
        <LocationField
          role="destination"
          label="Final destination"
          accent="bg-red-600"
          place={destination}
          onChange={(p) => set("destination", p)}
          picking={picking === "destination"}
          onTogglePick={() => setPicking(picking === "destination" ? null : "destination")}
          onError={setError}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {error}
        </p>
      )}
      <div
        data-testid="journey-picker-map"
        className={`relative h-64 overflow-hidden rounded-xl border sm:h-72 ${picking ? "ring-2 ring-blue-500" : "border-slate-200"}`}
        style={picking ? { cursor: "crosshair" } : undefined}
      >
        <div className="relative isolate z-0 h-full w-full" data-path-source={road ? "road" : "none"} data-path-points={road ? road.length : 0}>
          <MapContainer center={fitPoints[0] || DEFAULT_CENTER} zoom={12} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPick active={Boolean(picking)} onPick={(lat, lng) => pick(picking, lat, lng)} />
            <FitTo points={fitPoints} focus={focus} />
            {road && <Polyline positions={road} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }} />}
            {stopPts.map((s, i) => (
              <Marker key={s._id || i} position={[s.latitude, s.longitude]} icon={stopNumberIcon(i + 1)} />
            ))}
            {hasLL(start) && <Marker position={[start.latitude, start.longitude]} icon={startIcon} zIndexOffset={500} />}
            {hasLL(destination) && (
              <Marker position={[destination.latitude, destination.longitude]} icon={destinationIcon} zIndexOffset={500} />
            )}
          </MapContainer>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <LocateFixed size={12} /> Choose “Pick on map” for a location, then click the map. Blue numbered dots are the ordered stops.
      </p>
    </div>
  );
}

// Per-route panel: edit start/destination, save, and (re)calculate the road route.
export function RouteJourneyPanel({ route, onSaved, onError }) {
  const saved = useMemo(() => ({ start: route.start || null, destination: route.destination || null }), [route.start, route.destination]);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState("");
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const stats = (label, p) =>
    !p ? null : p.status === "ok" ? (
      <span data-testid={`journey-stat-${label}`}>
        {label}: <strong>{formatDistance(p.distanceMeters)}</strong> · est. drive {formatDuration(p.durationSeconds)}
      </span>
    ) : (
      <span className="text-amber-700" data-testid={`journey-stat-${label}`}>
        {label}: road route unavailable ({p.error || "routing service error"})
      </span>
    );

  const run = async (kind) => {
    setBusy(kind);
    onError("");
    try {
      if (kind === "save") {
        await routeApi.update(route._id, { start: draft.start, destination: draft.destination });
        await onSaved("Journey saved and road route recalculated.");
      } else {
        await routeApi.recalculate(route._id);
        await onSaved("Road route recalculated.");
      }
    } catch (err) {
      onError(err.response?.data?.message || "Could not save the journey.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="route-journey-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-800">Journey: start, destination &amp; road route</h3>
          <p className="text-xs text-slate-500">
            Intermediate stops are ordered below. The road path is calculated with OpenStreetMap routing (OSRM).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="journey-recalc"
            onClick={() => run("recalc")}
            disabled={Boolean(busy) || dirty}
            title={dirty ? "Save your changes first" : "Recalculate the road route"}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy === "recalc" ? "animate-spin" : ""} /> Recalculate
          </button>
          <button
            type="button"
            data-testid="journey-save"
            onClick={() => run("save")}
            disabled={Boolean(busy) || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={13} /> {busy === "save" ? "Saving & routing…" : "Save journey"}
          </button>
        </div>
      </div>

      <RouteJourneyEditor
        value={draft}
        onChange={setDraft}
        previewStops={(route.stops || []).filter((s) => typeof s === "object")}
        previewPath={route.roadPath}
      />

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600" data-testid="journey-stats-line">
        {stats("Morning", route.roadPath) || <span>No road route yet. Set a start and destination (or at least two stops) and save.</span>}
        {stats("Evening", route.eveningRoadPath)}
      </div>
    </div>
  );
}
