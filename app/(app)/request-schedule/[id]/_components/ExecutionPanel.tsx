'use client';

import { useState } from 'react';
import { Navigation, CheckCircle2, PlayCircle, Loader2, AlertTriangle, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { captureGeolocation, geoErrorMessage, type GeoReading } from '@/lib/geolocation';
import { haversineMeters, formatDistance } from '@/lib/utils';
import type { Activity } from '@/lib/types';

export function ExecutionPanel({
  activity, targetLat, targetLng, canAct, onChanged,
}: { activity: Activity; targetLat: number | null; targetLng: number | null; canAct: boolean; onChanged: () => void }) {
  const category = activity.activity_categories;
  const [reading, setReading] = useState<GeoReading | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  const requiresGps = category?.requires_gps ?? true;
  const hasTarget = targetLat != null && targetLng != null;
  const liveDistance = reading && hasTarget ? haversineMeters(reading.lat, reading.lng, targetLat!, targetLng!) : null;
  const radius = category?.gps_radius_m ?? 100;

  async function handleCapture() {
    setCapturing(true);
    setCaptureError(null);
    const { reading: r, error } = await captureGeolocation();
    setCapturing(false);
    if (error || !r) { setCaptureError(geoErrorMessage(error ?? 'unavailable')); setReading(null); return; }
    setReading(r);
  }

  async function handleStart() {
    setBusy(true);
    setRpcError(null);
    const { error } = await supabase.rpc('iwm_set_activity_status', { p_activity_id: activity.id, p_status: 'in_progress' });
    setBusy(false);
    if (error) { setRpcError(error.message); return; }
    onChanged();
  }

  async function handleComplete() {
    setBusy(true);
    setRpcError(null);
    setBlockReason(null);
    const { data, error } = await supabase.rpc('iwm_complete_activity', {
      p_activity_id: activity.id,
      p_lat: reading?.lat ?? null,
      p_lng: reading?.lng ?? null,
      p_accuracy: reading?.accuracy ?? null,
    });
    setBusy(false);
    if (error) { setRpcError(error.message); return; }
    if (data?.blocked) {
      setBlockReason(describeBlock(data));
      return;
    }
    fetch('/api/notifications/notify-completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityId: activity.id }),
    }).catch(() => {});
    onChanged();
  }

  if (activity.status === 'completed') {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-card p-5 flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
        <div>
          <p className="font-medium text-emerald-800">Activity Completed</p>
          <p className="text-sm text-emerald-700">
            {activity.gps_validation_status === 'valid' && activity.distance_from_target_m != null &&
              `GPS valid · ${formatDistance(activity.distance_from_target_m)} from target`}
          </p>
        </div>
      </div>
    );
  }

  if (activity.status === 'cancelled') {
    return <div className="bg-slate-100 border border-slate-200 rounded-card p-5 text-sm text-slate-500">This activity was cancelled.</div>;
  }

  return (
    <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3"><Navigation className="h-4 w-4" /> Execution</h3>

      {hasTarget && (
        <p className="text-xs text-slate-500 mb-3 flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Target: {targetLat!.toFixed(6)}, {targetLng!.toFixed(6)} · radius {radius}m
        </p>
      )}

      {activity.status === 'scheduled' && canAct && (
        <button onClick={handleStart} disabled={busy} className="w-full mb-4 inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-medium py-3 hover:bg-brand-700 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Start Execution
        </button>
      )}

      {activity.status === 'in_progress' && canAct && (
        <div className="space-y-4">
          <div className="rounded-control bg-slate-50 border border-slate-200 p-4 text-center">
            {reading ? (
              <>
                <p className="text-sm font-semibold text-slate-800">📍 GPS Captured</p>
                <p className="text-xs text-slate-500 mt-1">Accuracy ±{Math.round(reading.accuracy)}m</p>
                {liveDistance != null && (
                  <p className={`text-sm mt-1 font-medium ${liveDistance <= radius ? 'text-emerald-600' : 'text-red-600'}`}>
                    Distance: {formatDistance(liveDistance)} {liveDistance <= radius ? '(within radius)' : '(outside radius)'}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">{requiresGps ? 'GPS capture required before completing.' : 'GPS capture optional for this category.'}</p>
            )}
            <button onClick={handleCapture} disabled={capturing} className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
              {reading ? 'Recapture GPS' : 'Capture GPS'}
            </button>
            {captureError && <p className="text-xs text-red-600 mt-2">{captureError}</p>}
          </div>

          {blockReason && (
            <div className="flex items-start gap-2 rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {blockReason}
            </div>
          )}
          {rpcError && <p className="text-sm text-red-600">{rpcError}</p>}

          <button
            onClick={handleComplete}
            disabled={busy || (requiresGps && !reading)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-emerald-600 text-white font-semibold py-3.5 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} COMPLETE ACTIVITY
          </button>
        </div>
      )}

      {!canAct && activity.status !== 'completed' && (
        <p className="text-sm text-slate-400">You are not signed in to execute this activity.</p>
      )}
    </div>
  );
}

function describeBlock(data: { reason?: string; validation_status?: string; distance_m?: number; radius_m?: number; evidence_count?: number; required?: number }): string {
  if (data.reason === 'gps') {
    if (data.validation_status === 'outside_radius') {
      return `Completion blocked: you are ${formatDistance(data.distance_m)} from the target, outside the ${data.radius_m}m allowed radius.`;
    }
    if (data.validation_status === 'low_accuracy') return 'Completion blocked: GPS accuracy is too low. Move to an open area and recapture.';
    return 'Completion blocked: a valid GPS reading is required.';
  }
  if (data.reason === 'evidence') return `Completion blocked: ${data.evidence_count ?? 0} of ${data.required ?? 1} required photos uploaded.`;
  if (data.reason === 'personnel') return 'Completion blocked: at least one personnel record is required.';
  return 'Completion blocked.';
}
