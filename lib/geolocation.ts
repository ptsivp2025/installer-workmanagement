import { supabase } from './supabase';
import type { DictKey } from './i18n';

export interface GeoReading {
  lat: number;
  lng: number;
  accuracy: number;
}

export type GeoCaptureError = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/**
 * Wraps navigator.geolocation in a promise. Never throws for a denied/failed
 * read — callers pass a null lat/lng through to the completion RPC, which
 * records it as an 'unavailable' GPS event rather than pretending the
 * activity was never attempted (spec §11, §25).
 */
export function captureGeolocation(): Promise<{ reading: GeoReading | null; error: GeoCaptureError | null }> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ reading: null, error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        reading: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
        error: null,
      }),
      err => resolve({
        reading: null,
        error: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable',
      }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export interface GeoSample {
  lat: number;
  lng: number;
  acc: number;
  alt: number | null;
  /** The reading's own timestamp (epoch ms). A mock provider can repeat it. */
  ts: number;
  /** When this page received the reading (epoch ms) — what the server uses
   *  to measure how long the series really took. */
  at: number;
  /** Only inside the Android app: Android's own "this reading is fake"
   *  verdict, and whether a fake-location app is enabled at all. */
  mock?: boolean;
  mockApp?: boolean;
  src?: 'native' | 'web';
  /** The server challenge this series was captured under (migration 026). */
  nonce?: string;
  /** Android app 1.5+: the reading as the app signed it, the signature, and the key it used. */
  att?: string;
  sig?: string;
  kid?: string;
}

// Bridge installed by the Android app (android/…/NativeBridge.java).
declare global {
  interface Window {
    IWMNative?: {
      getLocation(callbackId: string): void;
      /** Since app 1.5: the reading signed together with the server's challenge. */
      getLocationSigned?(callbackId: string, nonce: string): void;
      version(): string;
      /** Since app 1.3: hide the native loading screen (lib/native.ts). */
      ready?(): void;
      /** Since app 1.3: look for a newer APK; manual = say so when there's none. */
      checkUpdate?(manual: boolean): void;
    };
    __iwmNativeLocation?: (id: string, result: NativeLocationResult) => void;
  }
}
type NativeLocationResult =
  | {
      ok: true; lat: number; lng: number; acc: number | null; alt: number | null; ts: number; mock: boolean; mockApp: boolean;
      att?: string; sig?: string; kid?: string;
    }
  | { ok: false; error: GeoCaptureError };

const nativeWaiters = new Map<string, (r: NativeLocationResult) => void>();

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.IWMNative;
}

function nativeReading(nonce: string | null): Promise<GeolocationPosition | GeoCaptureError | NativeLocationResult> {
  return new Promise(resolve => {
    if (!window.__iwmNativeLocation) {
      window.__iwmNativeLocation = (id, result) => {
        const done = nativeWaiters.get(id);
        nativeWaiters.delete(id);
        done?.(result);
      };
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { nativeWaiters.delete(id); resolve('timeout'); }, 20000);
    nativeWaiters.set(id, r => { clearTimeout(timer); resolve(r); });
    const bridge = window.IWMNative!;
    if (typeof bridge.getLocationSigned === 'function') bridge.getLocationSigned(id, nonce ?? '');
    else bridge.getLocation(id); // app before 1.5
  });
}

/**
 * A one-off challenge from the server for this capture (migration 026). The
 * server times it on its own clock, so a reading can't be taken on site and
 * submitted later from elsewhere. null when it can't be had (no signal, or
 * the migration isn't run yet): the capture still goes ahead and the server
 * decides what a missing challenge means.
 */
async function fetchGpsChallenge(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('iwm_gps_challenge');
    if (error) return null;
    const nonce = (data as { nonce?: unknown } | null)?.nonce;
    return typeof nonce === 'string' ? nonce : null;
  } catch {
    return null;
  }
}

/**
 * Several fresh readings a moment apart instead of one. The server
 * (iwm_gps_risk_flags, migration 023) needs the series to tell a real fix
 * from a Fake GPS app. Real GPS drifts a little between readings; a mock
 * location usually sits perfectly still with the same round accuracy, or
 * jumps around when a joystick moves it. `best` (the most accurate
 * reading) is what gets validated against the site radius.
 */
export async function captureGeolocationSamples(
  count = 4,
  gapMs = 1300,
  onProgress?: (done: number, total: number) => void,
): Promise<{ best: GeoReading | null; samples: GeoSample[]; error: GeoCaptureError | null }> {
  if (!navigator.geolocation) return { best: null, samples: [], error: 'unsupported' };

  const nonce = await fetchGpsChallenge();
  const samples: GeoSample[] = [];
  let firstError: GeoCaptureError | null = null;
  for (let i = 0; i < count; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, gapMs));
    // Inside the Android app, read through the native bridge: same fix,
    // plus Android's mock-location verdict, which no browser exposes.
    const raw = isNativeApp()
      ? await nativeReading(nonce)
      : await new Promise<GeolocationPosition | GeoCaptureError>(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve(pos),
          err => resolve(err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable'),
          { enableHighAccuracy: true, timeout: i === 0 ? 15000 : 8000, maximumAge: 0 },
        );
      });
    const result: GeolocationPosition | GeoCaptureError =
      typeof raw === 'object' && 'ok' in raw
        ? (raw.ok ? toPosition(raw) : raw.error)
        : raw;
    if (typeof result === 'string') {
      firstError ??= result;
      if (result === 'denied' || samples.length === 0) break; // nothing more will come
      continue;
    }
    const native = typeof raw === 'object' && 'ok' in raw && raw.ok ? raw : null;
    samples.push({
      lat: result.coords.latitude,
      lng: result.coords.longitude,
      acc: result.coords.accuracy,
      alt: result.coords.altitude,
      ts: result.timestamp,
      at: Date.now(),
      src: native ? 'native' : 'web',
      ...(nonce ? { nonce } : {}),
      ...(native ? { mock: native.mock, mockApp: native.mockApp } : {}),
      ...(native?.att && native.sig ? { att: native.att, sig: native.sig, kid: native.kid } : {}),
    });
    onProgress?.(samples.length, count);
  }

  if (samples.length === 0) return { best: null, samples, error: firstError ?? 'unavailable' };
  const b = samples.reduce((x, y) => (y.acc < x.acc ? y : x));
  return { best: { lat: b.lat, lng: b.lng, accuracy: b.acc }, samples, error: null };
}

function toPosition(r: Extract<NativeLocationResult, { ok: true }>): GeolocationPosition {
  return {
    timestamp: r.ts,
    coords: {
      latitude: r.lat, longitude: r.lng, accuracy: r.acc ?? 9999, altitude: r.alt,
      altitudeAccuracy: null, heading: null, speed: null,
    },
  } as GeolocationPosition;
}

/** The message for a failed capture, as an i18n key (lib/i18n.ts), so it shows in the user's language. */
export function geoErrorKey(error: GeoCaptureError): DictKey {
  switch (error) {
    case 'unsupported': return 'gpsError.unsupported';
    case 'denied': return 'gpsError.denied';
    case 'timeout': return 'gpsError.timeout';
    default: return 'gpsError.unavailable';
  }
}
