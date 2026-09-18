'use client';

/**
 * Interactive coordinate picker: search an address (Nominatim/OpenStreetMap,
 * free, no API key) or drag/click the pin directly, mirroring the
 * fieldserviceplatform baseline's MapPicker pattern.
 *
 * Leaflet touches `window` at import time, so it's dynamically imported
 * inside useEffect rather than statically — a top-level import would break
 * server-side rendering.
 */

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

function useAddressSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 600);
    return () => clearTimeout(t);
  }, [query]);

  return { query, setQuery, results, searching, clear: () => { setResults([]); setQuery(''); } };
}

export function MapPicker({
  lat, lng, onPick, height = 260,
}: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void; height?: number }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const { query, setQuery, results, searching, clear } = useAddressSearch();

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(L => {
      if (cancelled || !elRef.current || mapRef.current) return;
      const start: [number, number] = [lat ?? -6.2, lng ?? 106.816666];
      const map = L.map(elRef.current).setView(start, lat != null ? 16 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-90%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">📍</div>',
        className: '', iconSize: [0, 0],
      });
      const marker = L.marker(start, { draggable: true, icon }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPickRef.current(p.lat, p.lng);
      });
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      markerRef.current = marker;
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
    // Map is built once; external lat/lng changes are synced by the effect
    // below so the user's own drag/click doesn't fight a map rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || lat == null || lng == null) return;
    const current = markerRef.current.getLatLng();
    if (Math.abs(current.lat - lat) > 1e-7 || Math.abs(current.lng - lng) > 1e-7) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    }
  }, [lat, lng]);

  function selectResult(r: SearchResult) {
    onPickRef.current(parseFloat(r.lat), parseFloat(r.lon));
    clear();
  }

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search an address…"
          className="w-full rounded-control border border-slate-300 pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-white rounded-control border border-slate-200 shadow-modal max-h-52 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 truncate"
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={elRef} className="rounded-control border border-slate-200" style={{ height }} />
      <p className="text-xs text-slate-400 mt-1">Click the map or drag the pin to fine-tune.</p>
    </div>
  );
}
