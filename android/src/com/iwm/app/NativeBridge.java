package com.iwm.app;

import android.webkit.JavascriptInterface;

/**
 * Exposed to the web app as window.IWMNative. Its presence is also how the
 * web app knows it's running inside the Android app (lib/geolocation.ts).
 * JS interface calls arrive on a background thread, so work is posted to
 * the UI thread.
 */
public class NativeBridge {
    private final MainActivity activity;

    NativeBridge(MainActivity activity) { this.activity = activity; }

    @JavascriptInterface
    public String version() { return BuildInfo.VERSION; }

    /** The web app's first screen has its data; hide the loading screen. */
    @JavascriptInterface
    public void ready() {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { activity.onWebReady(); }
        });
    }

    /** The "Cek Update Aplikasi" menu item. */
    @JavascriptInterface
    public void checkUpdate(boolean manual) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { activity.checkUpdateManually(); }
        });
    }

    /**
     * One fresh location reading, with Android's own mock-location verdict.
     * The result is delivered asynchronously to
     * window.__iwmNativeLocation(id, result).
     */
    @JavascriptInterface
    public void getLocation(final String callbackId) {
        getLocationSigned(callbackId, "");
    }

    /**
     * Since app 1.5: the same reading, signed together with the challenge
     * the server issued for this capture (migration 026), so the server can
     * tell this app from a page pretending to be it.
     */
    @JavascriptInterface
    public void getLocationSigned(final String callbackId, final String nonce) {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { activity.requestNativeLocation(callbackId, nonce); }
        });
    }
}
