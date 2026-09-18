'use client';

/**
 * Read-only map: plots one or more fixed markers (e.g. target vs. captured
 * execution position) so the field team can visually confirm placement
 * instead of reading raw coordinates. No search, no drag — display only.
 */

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
  label: string;
}

export function LocationMap({ markers, height = 220 }: { markers: MapMarker[]; height?: number }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (markers.length === 0) return;

    import('leaflet').then(L => {
      if (cancelled || !elRef.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const map = L.map(elRef.current, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const m of markers) {
        const icon = L.divIcon({
          html: `<div style="width:18px;height:18px;border-radius:50%;background:${m.color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);transform:translate(-50%,-50%)"></div>`,
          className: '', iconSize: [0, 0],
        });
        L.marker([m.lat, m.lng], { icon }).addTo(map).bindTooltip(m.label, { permanent: false });
        bounds.push([m.lat, m.lng]);
      }

      if (bounds.length === 1) map.setView(bounds[0], 16);
      else map.fitBounds(bounds, { padding: [30, 30] });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.map(m => `${m.lat},${m.lng}`).join('|')]);

  if (markers.length === 0) return null;

  return <div ref={elRef} className="rounded-control border border-slate-200" style={{ height }} />;
}
