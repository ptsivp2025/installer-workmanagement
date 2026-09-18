'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import { Search, Loader2, MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

const DEFAULT_CENTER: [number, number] = [-6.2088, 106.8456]; // Jakarta

export function LocationPicker({
  address, latitude, longitude, onChange,
}: {
  address: string;
  latitude: string;
  longitude: string;
  onChange: (address: string, latitude: string, longitude: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  // Coordinates this component itself just emitted via onChange — lets the
  // prop-sync effect below tell "I moved the marker" from "the parent gave
  // me a new address/lat/lng" (e.g. an existing project just loaded) apart,
  // instead of fighting the drag/click handlers on every update.
  const lastEmitted = useRef<{ lat: string; lng: string } | null>(null);
  const addressRef = useRef(address);
  addressRef.current = address;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Init the map once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      // Default marker icon URLs break under bundlers — point them at the CDN.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const startLat = latitude ? Number(latitude) : DEFAULT_CENTER[0];
      const startLng = longitude ? Number(longitude) : DEFAULT_CENTER[1];

      const map = L.map(containerRef.current).setView([startLat, startLng], latitude ? 16 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([startLat, startLng], { draggable: true }).addTo(map);

      const emitFromLatLng = (lat: number, lng: number) => {
        const latStr = lat.toFixed(6);
        const lngStr = lng.toFixed(6);
        lastEmitted.current = { lat: latStr, lng: lngStr };
        onChangeRef.current(addressRef.current, latStr, lngStr);
      };

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        emitFromLatLng(pos.lat, pos.lng);
      });
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        emitFromLatLng(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the map when lat/lng change from OUTSIDE this component (e.g. an
  // existing project's coordinates finish loading into the parent form) —
  // skip if it's an echo of a change this component just emitted itself.
  useEffect(() => {
    if (!latitude || !longitude || !mapRef.current || !markerRef.current) return;
    if (lastEmitted.current?.lat === latitude && lastEmitted.current?.lng === longitude) return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
  }, [latitude, longitude]);

  // Debounced search-as-you-type against Nominatim (OpenStreetMap).
  useEffect(() => {
    if (!address || address.trim().length < 3) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&q=${encodeURIComponent(address)}`
        );
        const data = (await res.json()) as NominatimResult[];
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [address]);

  function selectResult(r: NominatimResult) {
    const lat = Number(r.lat).toFixed(6);
    const lng = Number(r.lon).toFixed(6);
    lastEmitted.current = { lat, lng };
    onChange(r.display_name, lat, lng);
    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([Number(lat), Number(lng)]);
      mapRef.current.setView([Number(lat), Number(lng)], 16);
    }
    setResults([]);
    setShowResults(false);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
      {/* relative + high z-index: the results dropdown must render above the
          Leaflet map below it, which otherwise sits on top (map panes/
          controls default to z-index up to ~1000 — the dropdown needs more). */}
      <div className="relative z-[1100]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={address}
            onChange={e => onChange(e.target.value, latitude, longitude)}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 150)}
            className="w-full rounded-control border border-slate-300 pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search address or place…"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />}
        </div>
        {showResults && results.length > 0 && (
          <ul className="absolute mt-1 w-full bg-white border border-slate-200 rounded-control shadow-modal max-h-56 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selectResult(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-start gap-2"
                >
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <span className="text-slate-700">{r.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={containerRef} className="mt-2 h-64 w-full rounded-control border border-slate-200 relative z-0" />
      {latitude && longitude && (
        <p className="text-xs text-slate-400 mt-1">{latitude}, {longitude} — drag the pin or click the map to fine-tune.</p>
      )}
    </div>
  );
}
