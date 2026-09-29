'use client';

import { useState } from 'react';
import { Navigation, CheckCircle2, PlayCircle, Loader2, AlertTriangle, MapPin, Circle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { captureGeolocationSamples, geoErrorKey, type GeoReading, type GeoSample } from '@/lib/geolocation';
import { haversineMeters, formatDistance, errorMessage } from '@/lib/utils';
import type { Activity } from '@/lib/types';
import { useLanguage } from '@/app/providers';
import type { Lang } from '@/lib/i18n';
import { translate } from '@/lib/i18n';
import { GpsCompareMap } from '@/components/shared/GpsCompareMap';

// Older readings are re-taken automatically on Complete (the server's own
// limit is 15 minutes, migration 026; this leaves room for a slow capture).
const READING_MAX_AGE_MS = 10 * 60 * 1000;

export function ExecutionPanel({
  activity, targetLat, targetLng, canAct, onChanged, evidenceCount, personnelCount,
}: {
  activity: Activity; targetLat: number | null; targetLng: number | null; canAct: boolean; onChanged: () => void;
  evidenceCount: number; personnelCount: number;
}) {
  const { t, lang } = useLanguage();
  const category = activity.activity_categories;
  const [reading, setReading] = useState<GeoReading | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [samples, setSamples] = useState<GeoSample[]>([]);
  const [captureProgress, setCaptureProgress] = useState<{ done: number; total: number } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  const requiresGps = category?.requires_gps ?? true;
  const hasTarget = targetLat != null && targetLng != null;
  const liveDistance = reading && hasTarget ? haversineMeters(reading.lat, reading.lng, targetLat!, targetLng!) : null;
  const radius = category?.gps_radius_m ?? 100;
  const minPhotos = category?.requires_evidence ? (category?.evidence_min_count ?? 1) : 0;
  const requiresTeam = !!category?.requires_personnel;

  // The same three checks iwm_complete_activity() runs server-side, shown
  // up front. Before, the only way to learn a photo was missing was to press
  // Complete and read the refusal — and the upload button sat further down
  // the page, below this one. Guidance only: the photo count here is what
  // this viewer's RLS lets them see, so the server keeps the final say.
  const checklist = [
    ...(requiresGps ? [{ key: 'gps', ok: !!reading, label: t('execution.reqGps'), href: null as string | null }] : []),
    ...(minPhotos > 0 ? [{ key: 'photos', ok: evidenceCount >= minPhotos, label: t('execution.reqPhotos', { count: evidenceCount, min: minPhotos }), href: '#evidence' }] : []),
    ...(requiresTeam ? [{ key: 'team', ok: personnelCount > 0, label: t('execution.reqTeam'), href: '#personnel' }] : []),
  ];

  /** One GPS capture (4 readings under a fresh server challenge); null if it failed. */
  async function capture(): Promise<{ best: GeoReading; samples: GeoSample[] } | null> {
    setCapturing(true);
    setCaptureError(null);
    setBlockReason(null);
    setCaptureProgress({ done: 0, total: 4 });
    const { best, samples: s, error } = await captureGeolocationSamples(4, 1300, (done, total) => setCaptureProgress({ done, total }));
    setCapturing(false);
    setCaptureProgress(null);
    if (error || !best) {
      setCaptureError(t(geoErrorKey(error ?? 'unavailable')));
      setReading(null);
      setSamples([]);
      setCapturedAt(null);
      return null;
    }
    setReading(best);
    setSamples(s);
    setCapturedAt(Date.now());
    return { best, samples: s };
  }

  async function handleCapture() {
    await capture();
  }

  // Starting a GPS-verified job is a check-in on site (025): same readings,
  // same Fake GPS checks and radius as completing it.
  async function handleStart() {
    setBusy(true);
    setRpcError(null);
    setBlockReason(null);
    setCaptureError(null);
    let best: GeoReading | null = null;
    let series: GeoSample[] = [];
    if (requiresGps) {
      setCapturing(true);
      setCaptureProgress({ done: 0, total: 4 });
      const r = await captureGeolocationSamples(4, 1300, (done, total) => setCaptureProgress({ done, total }));
      setCapturing(false);
      setCaptureProgress(null);
      if (r.error || !r.best) { setBusy(false); setCaptureError(t(geoErrorKey(r.error ?? 'unavailable'))); return; }
      best = r.best;
      series = r.samples;
    }
    let { data, error } = await supabase.rpc('iwm_start_activity', {
      p_activity_id: activity.id,
      p_lat: best?.lat ?? null, p_lng: best?.lng ?? null, p_accuracy: best?.accuracy ?? null,
      p_samples: series.length > 0 ? series : null,
    });
    // Migration 025 not run yet on this database: start the old way.
    if (error?.code === 'PGRST202') {
      ({ data, error } = await supabase.rpc('iwm_set_activity_status', { p_activity_id: activity.id, p_status: 'in_progress' }));
    }
    setBusy(false);
    if (error) { setRpcError(errorMessage(error, t('common.actionFailed'))); return; }
    if (data?.blocked) { setBlockReason(describeBlock(data, lang)); return; }
    onChanged();
  }

  async function handleComplete() {
    setBusy(true);
    setRpcError(null);
    setBlockReason(null);
    // The server refuses a reading taken more than 15 minutes ago (026): it
    // proves where the phone was then, not now. Rather than let someone who
    // captured GPS, took their photos and then pressed Complete run into
    // that, take a fresh reading here first.
    let current = reading;
    let series = samples;
    if (requiresGps && (!current || !capturedAt || Date.now() - capturedAt > READING_MAX_AGE_MS)) {
      const fresh = await capture();
      if (!fresh) { setBusy(false); return; }
      current = fresh.best;
      series = fresh.samples;
    }
    const { data, error } = await supabase.rpc('iwm_complete_activity', {
      p_activity_id: activity.id,
      p_lat: current?.lat ?? null,
      p_lng: current?.lng ?? null,
      p_accuracy: current?.accuracy ?? null,
      // The raw series is what lets the server spot a Fake GPS app (023).
      p_samples: series.length > 0 ? series : null,
    });
    setBusy(false);
    if (error) { setRpcError(errorMessage(error, t('common.actionFailed'))); return; }
    if (data?.blocked) {
      setBlockReason(describeBlock(data, lang));
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
      <div className="bg-white rounded-card border border-slate-200 shadow-bento p-5 space-y-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
          <div>
            <p className="font-medium text-emerald-800">{t('execution.activityCompleted')}</p>
            <p className="text-sm text-slate-500">
              {activity.gps_validation_status === 'valid' && activity.distance_from_target_m != null &&
                `${t('execution.gpsValid')} · ${formatDistance(activity.distance_from_target_m)} ${t('formReview.fromTarget')}`}
            </p>
          </div>
        </div>
        <GpsCompareMap
          targetLat={targetLat} targetLng={targetLng}
          installerLat={activity.execution_latitude} installerLng={activity.execution_longitude}
        />
      </div>
    );
  }

  if (activity.status === 'cancelled') {
    return <div className="bg-slate-100 border border-slate-200 rounded-card p-5 text-sm text-slate-500">{t('execution.cancelled')}</div>;
  }

  return (
    <div className="bg-white rounded-card border border-slate-200 shadow-bento p-5">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3"><Navigation className="h-4 w-4" /> {t('execution.title')}</h3>

      {hasTarget && (
        <p className="text-xs text-slate-500 mb-3 flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {t('execution.targetLabel')}: {targetLat!.toFixed(6)}, {targetLng!.toFixed(6)} · {t('execution.radius')} {radius}m
        </p>
      )}

      {activity.status === 'scheduled' && canAct && (
        <div className="mb-4 space-y-3">
          <button onClick={handleStart} disabled={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-medium py-3 hover:bg-brand-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {capturing && captureProgress
              ? t('execution.lockingGps', { done: captureProgress.done, total: captureProgress.total })
              : requiresGps ? t('execution.startWithCheckin') : t('execution.startExecution')}
          </button>
          {requiresGps && <p className="text-xs text-slate-500 text-center">{t('execution.startCheckinHint')}</p>}
          {captureError && <p className="text-xs text-red-600 text-center">{captureError}</p>}
          {blockReason && (
            <div className="flex items-start gap-2 rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {blockReason}
            </div>
          )}
          {rpcError && <p className="text-sm text-red-600">{rpcError}</p>}
        </div>
      )}

      {activity.status === 'in_progress' && canAct && (
        <div className="space-y-4">
          <div className="rounded-control bg-slate-50 border border-slate-200 p-4 text-center">
            {reading ? (
              <>
                <p className="text-sm font-semibold text-slate-800">📍 {t('execution.gpsCaptured')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('execution.accuracy')} ±{Math.round(reading.accuracy)}m</p>
                {liveDistance != null && (
                  <p className={`text-sm mt-1 font-medium ${liveDistance <= radius ? 'text-emerald-600' : 'text-red-600'}`}>
                    {t('execution.distance')}: {formatDistance(liveDistance)} {liveDistance <= radius ? `(${t('execution.withinRadius')})` : `(${t('execution.outsideRadius')})`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">{requiresGps ? t('execution.gpsRequired') : t('execution.gpsOptional')}</p>
            )}
            <button onClick={handleCapture} disabled={capturing} className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
              {capturing && captureProgress
                ? t('execution.lockingGps', { done: captureProgress.done, total: captureProgress.total })
                : reading ? t('execution.recaptureGps') : t('execution.captureGps')}
            </button>
            {captureError && <p className="text-xs text-red-600 mt-2">{captureError}</p>}
          </div>

          {(reading || hasTarget) && (
            <GpsCompareMap targetLat={targetLat} targetLng={targetLng} installerLat={reading?.lat ?? null} installerLng={reading?.lng ?? null} />
          )}

          {checklist.length > 0 && (
            <div className="rounded-control border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500 mb-2">{t('execution.checklistTitle')}</p>
              <ul className="space-y-1.5">
                {checklist.map(c => (
                  <li key={c.key} className="flex items-center gap-2 text-sm">
                    {c.ok
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      : <Circle className="h-4 w-4 text-slate-300 shrink-0" />}
                    <span className={c.ok ? 'text-slate-500' : 'text-slate-800 font-medium'}>{c.label}</span>
                    {!c.ok && c.href && (
                      <a href={c.href} className="ml-auto text-xs font-medium text-brand-600 hover:underline shrink-0">{t('execution.goThere')}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blockReason && (
            <div className="flex items-start gap-2 rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {blockReason}
            </div>
          )}
          {rpcError && <p className="text-sm text-red-600">{rpcError}</p>}

          <button
            onClick={handleComplete}
            // Not while a capture is running: it would send the previous reading.
            disabled={busy || capturing || (requiresGps && !reading)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-emerald-600 text-white font-semibold py-3.5 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t('execution.completeActivity')}
          </button>
        </div>
      )}

      {!canAct && activity.status !== 'completed' && (
        <p className="text-sm text-slate-400">{t('execution.viewOnly')}</p>
      )}
    </div>
  );
}

function describeBlock(data: { reason?: string; validation_status?: string; signals?: string[]; distance_m?: number; radius_m?: number; evidence_count?: number; required?: number }, lang: Lang): string {
  if (data.reason === 'gps') {
    if (data.validation_status === 'outside_radius') {
      return translate(lang, 'execution.blockedGpsRadius', { distance: formatDistance(data.distance_m), radius: data.radius_m ?? 0 });
    }
    if (data.validation_status === 'low_accuracy') return translate(lang, 'execution.blockedGpsAccuracy');
    if (data.validation_status === 'suspected_mock') {
      // Most specific first: what the installer has to do differs per cause.
      const s = new Set(data.signals ?? []);
      const any = (...keys: string[]) => keys.some(k => s.has(k));
      if (any('emulator', 'virtual_env')) return translate(lang, 'execution.blockedGpsEmulator');
      if (any('mock_provider', 'frozen_precise', 'zero_accuracy', 'sample_jump')) return translate(lang, 'execution.blockedGpsMock');
      if (any('bad_signature')) return translate(lang, 'execution.blockedGpsUpdateApp');
      if (any('stale_reading')) return translate(lang, 'execution.blockedGpsStale');
      if (any('web_browser')) return translate(lang, 'execution.blockedGpsNeedApp');
      if (any('rooted')) return translate(lang, 'execution.blockedGpsRooted');
      if (any('no_samples', 'bad_challenge', 'no_challenge')) return translate(lang, 'execution.blockedGpsReload');
      return translate(lang, 'execution.blockedGpsMock');
    }
    return translate(lang, 'execution.blockedGpsGeneric');
  }
  if (data.reason === 'evidence') return translate(lang, 'execution.blockedEvidence', { count: data.evidence_count ?? 0, required: data.required ?? 1 });
  if (data.reason === 'personnel') return translate(lang, 'execution.blockedPersonnel');
  return translate(lang, 'execution.blockedGeneric');
}
