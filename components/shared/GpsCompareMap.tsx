'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '@/app/providers';

/**
 * Read-only map showing where the project's target is (red pin) against
 * where the installer's GPS was actually captured (blue pin) — replacing a
 * plain "GPS: valid, 12m" text line with something a field user can see at
 * a glance, not just read (spec: match project location vs installer
 * location visually, red/blue).
 */
export function GpsCompareMap({
  targetLat, targetLng, installerLat, installerLng,
}: { targetLat: number | null; targetLng: number | null; installerLat: number | null; installerLng: number | null }) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);

  const hasTarget = targetLat != null && targetLng != null;
  const hasInstaller = installerLat != null && installerLng != null;

  useEffect(() => {
    if (!hasTarget && !hasInstaller) return;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      // Inline SVG pins instead of the default PNG marker images — exact
      // red/blue colors (no CSS-filter approximation) and no extra CDN
      // dependency beyond the tile server itself.
      const pinSvg = (hex: string) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">` +
        `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z" fill="${hex}" stroke="white" stroke-width="1.5"/>` +
        `<circle cx="13" cy="13" r="5" fill="white"/></svg>`;
      const makeIcon = (hex: string) => L.divIcon({
        html: pinSvg(hex), className: '', iconSize: [26, 36], iconAnchor: [13, 36], tooltipAnchor: [0, -30],
      });
      const redIcon = makeIcon('#ef4444');
      const blueIcon = makeIcon('#3b82f6');

      const points: [number, number][] = [];
      if (hasTarget) points.push([targetLat!, targetLng!]);
      if (hasInstaller) points.push([installerLat!, installerLng!]);

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { zoomControl: false, dragging: true, scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
        }).addTo(mapRef.current);
        markersRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const map = mapRef.current;
      const markers = markersRef.current!;
      markers.clearLayers();

      if (hasTarget) L.marker([targetLat!, targetLng!], { icon: redIcon }).addTo(markers).bindTooltip(t('execution.targetLabel'));
      if (hasInstaller) L.marker([installerLat!, installerLng!], { icon: blueIcon }).addTo(markers).bindTooltip(t('execution.installerLabel'));
      if (hasTarget && hasInstaller) {
        L.polyline(points, { color: '#64748b', weight: 2, dashArray: '4 6' }).addTo(markers);
        map.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
      } else if (points.length === 1) {
        map.setView(points[0], 16);
      }
    })();

    return () => { cancelled = true; };
  }, [hasTarget, hasInstaller, targetLat, targetLng, installerLat, installerLng, t]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; markersRef.current = null; }, []);

  if (!hasTarget && !hasInstaller) return null;

  return (
    <div>
      <div ref={containerRef} className="h-48 w-full rounded-control border border-slate-200" />
      <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" /> {t('execution.targetLabel')}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-500 inline-block" /> {t('execution.installerLabel')}</span>
      </div>
    </div>
  );
}
