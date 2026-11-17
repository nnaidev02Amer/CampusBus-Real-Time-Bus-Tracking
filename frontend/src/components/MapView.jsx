import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Circle,
  useMap,
} from "react-leaflet";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { hasLL } from "../utils/routePath";

const busIcon = L.divIcon({
  className: "bus-marker",
  html: '<div style="width:38px;height:38px;border-radius:14px;background:#0f172a;color:white;display:grid;place-items:center;border:3px solid white;box-shadow:0 4px 16px rgba(0,0,0,.25);font-size:19px">🚌</div>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});
const staleBusIcon = L.divIcon({
  className: "bus-marker",
  html: '<div style="width:38px;height:38px;border-radius:14px;background:#64748b;color:white;display:grid;place-items:center;border:3px dashed #f59e0b;opacity:.75;font-size:19px">🚌</div>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});
// Distinct journey markers: Start (green), numbered Stops (blue), Destination (red).
const pin = (cls, bg, label, size) =>
  L.divIcon({
    className: cls,
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;display:grid;place-items:center;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);font:800 ${Math.round(size * 0.42)}px/1 system-ui,sans-serif">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
export const startIcon = pin("route-start-marker", "#16a34a", "S", 32);
export const destinationIcon = pin("route-destination-marker", "#dc2626", "D", 32);
export const stopNumberIcon = (n) => pin("route-stop-marker stop-marker", "#2563eb", n, 24);

// Fits the map to the whole journey once per route (never on live GPS updates),
// and re-fits ONCE if the live bus first appears outside the framed area, so the
// route stays visible without the zoom being reset on every fix.
function FitRoute({ fitPoints, fitKey, bus }) {
  const map = useMap();
  const fittedKey = useRef(null);
  const busFitted = useRef(false);
  const busLat = bus?.[0];
  const busLng = bus?.[1];
  useEffect(() => {
    if (!fitPoints.length || fittedKey.current === fitKey) return;
    fittedKey.current = fitKey;
    busFitted.current = false;
    const all = Number.isFinite(busLat) ? [...fitPoints, [busLat, busLng]] : fitPoints;
    if (Number.isFinite(busLat)) busFitted.current = true;
    map.fitBounds(L.latLngBounds(all), { padding: [28, 28], maxZoom: 16, animate: false });
  }, [map, fitKey]);
  useEffect(() => {
    if (!fitPoints.length || busFitted.current || !Number.isFinite(busLat)) return;
    busFitted.current = true;
    if (!map.getBounds().contains([busLat, busLng])) {
      map.fitBounds(L.latLngBounds([...fitPoints, [busLat, busLng]]), {
        padding: [28, 28],
        maxZoom: 16,
        animate: false,
      });
    }
  }, [map, busLat, busLng]);
  return null;
}

// Keeps the bus in view as new fixes arrive, without resetting the user's zoom
// and without fighting them when the bus is already visible.
function FollowBus({ position, firstFixZoom }) {
  const map = useMap();
  const lat = position?.[0];
  const lng = position?.[1];
  const zoomed = useRef(false);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // With no route to frame (e.g. a test bus without a route) the default city
    // zoom makes a walking-pace bus look frozen, so zoom to street level ONCE.
    if (firstFixZoom && !zoomed.current) {
      zoomed.current = true;
      map.setView([lat, lng], firstFixZoom, { animate: false });
      return;
    }
    if (!map.getBounds().pad(-0.15).contains([lat, lng]))
      map.panTo([lat, lng], { animate: true });
  }, [map, lat, lng]);
  return null;
}

function fmtAge(ts) {
  if (!ts) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full border border-white shadow" style={{ background: color }} />
      {label}
    </span>
  );
}

export default function MapView({
  location,
  stops = [],
  route = [],
  selectedStopId,
  stale = false,
  // Journey (all optional - legacy callers keep the old behaviour):
  start = null,
  destination = null,
  roadPath = null, // { coordinates: [[lat,lng],...] } from OSRM
  pathStatus = "none", // "ok" | "unavailable" | "none"
}) {
  const validStops = stops.filter(hasLL);
  const stopPoints = (route.length ? route : stops)
    .filter(hasLL)
    .map((s) => [s.latitude, s.longitude]);
  const roadPoints =
    roadPath?.coordinates?.length > 1 ? roadPath.coordinates : null;
  const startPoint = hasLL(start) ? [start.latitude, start.longitude] : null;
  const destPoint = hasLL(destination) ? [destination.latitude, destination.longitude] : null;

  // Straight-line fallback (legacy look) when there is no road geometry.
  const straightPoints = [startPoint, ...stopPoints, destPoint].filter(Boolean);
  const fitPoints = roadPoints || straightPoints;
  const hasRoute = fitPoints.length > 0;
  const fitKey = `${fitPoints.length}|${fitPoints[0]}|${fitPoints[fitPoints.length - 1]}|${roadPoints ? "road" : "line"}`;

  const isLiveLocation = Boolean(
    location &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    (stale || (location.isLive !== false && !location.stale))
  );
  const simulated = location?.source === "simulator";
  const center = isLiveLocation
    ? [location.latitude, location.longitude]
    : stopPoints[Math.floor(stopPoints.length / 2)] || fitPoints[0] || [22.7196, 75.8577];
  const showLegend = Boolean(startPoint || destPoint);
  return (
    // isolate: keeps Leaflet's internal z-indexes (400-1000) inside the map so
    // header dropdowns (notification panel) always render above it.
    <div
      className="relative isolate z-0 h-full w-full"
      data-path-source={roadPoints ? "road" : straightPoints.length > 1 ? "straight" : "none"}
      data-path-points={roadPoints ? roadPoints.length : straightPoints.length}
    >
    {simulated && isLiveLocation && (
      <div
        data-testid="map-test-badge"
        className="pointer-events-none absolute right-2 top-2 z-[1000] rounded-full bg-fuchsia-600 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow"
      >
        TEST MODE · SIMULATED GPS
      </div>
    )}
    {showLegend && (
      <div
        data-testid="map-legend"
        className="pointer-events-none absolute bottom-6 left-2 z-[1000] flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 shadow"
      >
        <LegendDot color="#16a34a" label="Start" />
        <LegendDot color="#2563eb" label="Stop" />
        <LegendDot color="#dc2626" label="Destination" />
        <LegendDot color="#0f172a" label="Bus" />
      </div>
    )}
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {hasRoute && <FitRoute fitPoints={fitPoints} fitKey={fitKey} bus={isLiveLocation ? [location.latitude, location.longitude] : null} />}
      {roadPoints ? (
        <Polyline
          positions={roadPoints}
          pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }}
        />
      ) : (
        straightPoints.length > 1 && (
          <Polyline
            positions={straightPoints}
            pathOptions={{
              color: "#2563eb",
              weight: 5,
              opacity: 0.75,
              ...(pathStatus === "unavailable" ? { dashArray: "8 10", color: "#d97706" } : {}),
            }}
          />
        )
      )}
      {validStops.map((s, i) => (
        <Marker
          key={s._id || s.sequence}
          position={[s.latitude, s.longitude]}
          icon={stopNumberIcon(i + 1)}
        >
          <Popup>
            <strong>{s.name}</strong>
            <br />
            Stop {i + 1}
          </Popup>
        </Marker>
      ))}
      {startPoint && (
        <Marker position={startPoint} icon={startIcon} zIndexOffset={500}>
          <Popup>
            <strong>Start</strong>
            <br />
            {start.name}
          </Popup>
        </Marker>
      )}
      {destPoint && (
        <Marker position={destPoint} icon={destinationIcon} zIndexOffset={500}>
          <Popup>
            <strong>Destination</strong>
            <br />
            {destination.name}
          </Popup>
        </Marker>
      )}
      {selectedStopId &&
        validStops
          .filter((s) => s._id === selectedStopId)
          .map((s) => (
            <CircleMarker
              key={"selected" + s._id}
              center={[s.latitude, s.longitude]}
              radius={18}
              pathOptions={{ color: "#16a34a", weight: 3, fillOpacity: 0.08 }}
            />
          ))}
      {isLiveLocation && (
        <>
          <FollowBus
            position={[location.latitude, location.longitude]}
            firstFixZoom={hasRoute || validStops.length ? 0 : 16}
          />
          {!stale && !simulated && Number.isFinite(location.accuracy) && location.accuracy > 0 && location.accuracy < 500 && (
            <Circle
              center={[location.latitude, location.longitude]}
              radius={location.accuracy}
              pathOptions={{ color: "#2563eb", weight: 1, fillOpacity: 0.08 }}
            />
          )}
          <Marker
            position={[location.latitude, location.longitude]}
            icon={stale ? staleBusIcon : busIcon}
            zIndexOffset={1000}
          >
            <Popup>
              <strong>
                {stale ? "Last known bus position" : simulated ? "Simulated Bus" : "Live Bus"}
              </strong>
              <br />
              {stale
                ? `Signal lost${fmtAge(location.timestamp) ? ` · updated ${fmtAge(location.timestamp)}` : ""}`
                : simulated
                  ? "Demo data from the admin simulator"
                  : location.speed != null
                    ? `${Math.round(location.speed)} km/h`
                    : "Live GPS location"}
            </Popup>
          </Marker>
        </>
      )}
    </MapContainer>
    </div>
  );
}
