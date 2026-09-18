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

export function geoErrorMessage(error: GeoCaptureError): string {
  switch (error) {
    case 'unsupported': return 'This browser does not support GPS.';
    case 'denied': return 'Location permission was denied. Enable it in your browser settings to continue.';
    case 'timeout': return 'GPS took too long to respond. Try again in an open area.';
    default: return 'Could not read GPS location right now.';
  }
}
