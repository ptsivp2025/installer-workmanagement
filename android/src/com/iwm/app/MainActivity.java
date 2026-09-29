package com.iwm.app;

import android.Manifest;
import android.app.Activity;
import android.app.AppOpsManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Installer Work Management: the web app in a WebView, plus the one thing a
 * browser can't do, which is ask Android whether a location is fake.
 *
 * Built without Gradle/androidx (see build.sh), so the code sticks to plain
 * framework APIs available at API 23 and uses no lambdas.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_LOCATION = 2;
    private static final long FIX_TIMEOUT_MS = 15000;
    private static final long NETWORK_FALLBACK_AFTER_MS = 8000;

    private WebView web;
    private String baseUrl;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;

    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private final List<String> pendingLocationIds = new ArrayList<String>();
    // Server challenge per location request (migration 026), signed into the reading.
    private final Map<String, String> locationNonces = new HashMap<String, String>();
    private final Handler handler = new Handler(Looper.getMainLooper());

    // Loading screen: up on every launch until the web app says its first
    // screen has its data (NativeBridge.ready), never just a half-drawn page.
    private static final long READY_FALLBACK_MS = 20000;
    private static final long MIN_LOADING_MS = 700;
    private View loadingOverlay;
    private long loadingShownAt;
    private boolean appReady;
    private UpdateChecker updater;

    // ── lifecycle ────────────────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        cleanOldPhotos();
        updater = new UpdateChecker(this);
        baseUrl = BuildInfo.APP_URL.length() > 0 ? BuildInfo.APP_URL : prefs().getString("url", "");
        if (baseUrl.length() == 0) showSetup(null);
        else showWeb();
        if (!hasLocationPermission()) requestLocationPermission();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // WebView writes cookies to disk only every ~30 s. Swiping the app
        // away right after logging in could lose the login cookie and show
        // the login screen again on the next launch. Save it now.
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private SharedPreferences prefs() { return getSharedPreferences("iwm", MODE_PRIVATE); }

    // ── first-run server address (only when no URL was built in) ────────
    private void showSetup(String error) {
        LinearLayout box = column();
        TextView title = text("Installer Work Management", 22, true);
        TextView hint = text("Masukkan alamat server aplikasi (contoh: https://nama-aplikasi.vercel.app). Cukup sekali.", 15, false);
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://…");
        input.setText(prefs().getString("url", ""));
        TextView err = text(error == null ? "" : error, 14, false);
        err.setTextColor(Color.rgb(220, 38, 38));
        Button save = new Button(this);
        save.setText("Simpan & Buka");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String url = input.getText().toString().trim();
                while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
                if (!url.startsWith("https://") || url.length() < 12) {
                    showSetup("Alamat harus diawali https://");
                    return;
                }
                prefs().edit().putString("url", url).apply();
                baseUrl = url;
                showWeb();
            }
        });
        box.addView(title); box.addView(hint); box.addView(input); box.addView(err); box.addView(save);
        setContentView(box);
    }

    // ── no connection / server unreachable ───────────────────────────────
    private void showOffline(String detail) {
        LinearLayout box = column();
        box.addView(text("Tidak bisa terhubung", 22, true));
        box.addView(text("Periksa sinyal atau koneksi internet, lalu coba lagi.\n\n" + detail, 15, false));
        Button retry = new Button(this);
        retry.setText("Coba Lagi");
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showWeb(); }
        });
        box.addView(retry);
        if (BuildInfo.APP_URL.length() == 0) {
            Button change = new Button(this);
            change.setText("Ubah Alamat Server");
            change.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { showSetup(null); }
            });
            box.addView(change);
        }
        setContentView(box);
    }

    // ── the web app ──────────────────────────────────────────────────────
    private void showWeb() {
        if (web == null) {
            web = new WebView(this);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);        // sessionStorage (auth token) + localStorage
            s.setDatabaseEnabled(true);
            s.setGeolocationEnabled(true);
            s.setAllowFileAccess(false);
            s.setMediaPlaybackRequiresUserGesture(true);
            s.setUserAgentString(s.getUserAgentString() + " IWMApp/" + BuildInfo.VERSION);

            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(web, true);

            web.addJavascriptInterface(new NativeBridge(this), "IWMNative");
            web.setWebViewClient(new AppWebViewClient());
            web.setWebChromeClient(new AppChromeClient());
            web.loadUrl(baseUrl + "/");
        }
        if (web.getParent() != null) ((ViewGroup) web.getParent()).removeView(web);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (!appReady) {
            loadingOverlay = loadingView();
            root.addView(loadingOverlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            loadingShownAt = System.currentTimeMillis();
            handler.postDelayed(new Runnable() {
                @Override public void run() { onWebReady(); } // never leave anyone stuck on it
            }, READY_FALLBACK_MS);
        }
        setContentView(root);
    }

    private View loadingView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        box.setClickable(true); // swallow taps meant for the page underneath
        int size = (int) (112 * getResources().getDisplayMetrics().density);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(size, size));
        ProgressBar spinner = new ProgressBar(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (28 * getResources().getDisplayMetrics().density);
        box.addView(spinner, lp);
        TextView label = text("Memuat data…", 15, false);
        label.setTextColor(Color.rgb(100, 116, 139));
        label.setGravity(Gravity.CENTER);
        label.setPadding(0, (int) (12 * getResources().getDisplayMetrics().density), 0, 0);
        box.addView(label);
        return box;
    }

    /** From NativeBridge.ready() or the fallback timer, whichever comes first. */
    void onWebReady() {
        if (appReady) return;
        appReady = true;
        long wait = Math.max(0, MIN_LOADING_MS - (System.currentTimeMillis() - loadingShownAt));
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (loadingOverlay != null) {
                    final View v = loadingOverlay;
                    loadingOverlay = null;
                    v.animate().alpha(0f).setDuration(250).withEndAction(new Runnable() {
                        @Override public void run() { if (v.getParent() != null) ((ViewGroup) v.getParent()).removeView(v); }
                    }).start();
                }
                updater.check(baseUrl, false); // quietly, once per launch
            }
        }, wait);
    }

    void checkUpdateManually() { updater.check(baseUrl, true); }

    private boolean isOwnUrl(Uri uri) {
        Uri base = Uri.parse(baseUrl);
        return uri.getHost() != null && uri.getHost().equalsIgnoreCase(base.getHost());
    }

    private class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            // Only the app's own site loads in here (window.IWMNative must
            // never be reachable by another site). Maps, WhatsApp, phone
            // numbers and so on open in their own apps.
            if (("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && isOwnUrl(uri)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) { }
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            // This (old) callback only fires for the main page, which is
            // exactly when the whole screen would otherwise be a browser
            // error page.
            showOffline(description == null ? "" : description);
        }
    }

    private class AppChromeClient extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false);
            } else {
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                requestLocationPermission();
            }
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;

            Intent camera = cameraIntent();
            Intent chooser;
            if (params.isCaptureEnabled()) {
                // <input capture>: camera only. That's what the web app uses for
                // GPS-verified jobs, where an old gallery photo isn't allowed.
                chooser = camera;
            } else {
                Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
                gallery.setType("image/*");
                gallery.addCategory(Intent.CATEGORY_OPENABLE);
                gallery.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                chooser = Intent.createChooser(gallery, "Pilih foto");
                if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
            }
            if (chooser == null) { fileCallback.onReceiveValue(null); fileCallback = null; return true; }
            try {
                startActivityForResult(chooser, REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback.onReceiveValue(null);
                fileCallback = null;
            }
            return true;
        }
    }

    private Intent cameraIntent() {
        cameraFile = new File(CameraProvider.dir(this), "IMG_" + System.currentTimeMillis() + ".jpg");
        cameraUri = CameraProvider.uriFor(cameraFile);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("", cameraUri));
        return i;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                ClipData clip = data.getClipData();
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
                // A camera app may echo our own output URI back as clip data.
                if (result.length == 1 && cameraUri != null && cameraUri.equals(result[0]) && !photoTaken()) result = null;
            } else if (data != null && data.getData() != null && !data.getData().equals(cameraUri)) {
                result = new Uri[] { data.getData() };
            } else if (photoTaken()) {
                result = new Uri[] { cameraUri };
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private boolean photoTaken() { return cameraFile != null && cameraFile.exists() && cameraFile.length() > 0; }

    private void cleanOldPhotos() {
        File[] files = CameraProvider.dir(this).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 3L * 24 * 3600 * 1000;
        for (File f : files) if (f.lastModified() < cutoff) f.delete();
    }

    // ── permissions ──────────────────────────────────────────────────────
    private boolean hasLocationPermission() {
        return Build.VERSION.SDK_INT < 23
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestLocationPermission() {
        if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQ_LOCATION) return;
        boolean granted = hasLocationPermission();
        if (pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
        }
        List<String> ids = new ArrayList<String>(pendingLocationIds);
        pendingLocationIds.clear();
        for (String id : ids) {
            if (granted) requestNativeLocation(id);
            else deliverLocation(id, error("denied"));
        }
    }

    // ── native location with mock detection ─────────────────────────────
    void requestNativeLocation(final String id, String nonce) {
        // A nonce is a UUID. Anything else is dropped rather than signed, so
        // a page can't smuggle extra "|" fields into the signed payload.
        locationNonces.put(id, nonce != null && nonce.matches("[0-9a-fA-F-]{36}") ? nonce : "");
        requestNativeLocation(id);
    }

    private void requestNativeLocation(final String id) {
        if (!hasLocationPermission()) {
            pendingLocationIds.add(id);
            requestLocationPermission();
            return;
        }
        final LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        final boolean gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        final boolean netOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gpsOn && !netOn) { deliverLocation(id, error("unavailable")); return; }

        final Location[] fallback = new Location[1];
        final boolean[] done = new boolean[1];
        final long startedAt = System.currentTimeMillis();

        final LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location loc) {
                if (done[0]) return;
                boolean isGps = LocationManager.GPS_PROVIDER.equals(loc.getProvider());
                if (isGps || !gpsOn || System.currentTimeMillis() - startedAt > NETWORK_FALLBACK_AFTER_MS) {
                    deliver(loc);
                } else {
                    fallback[0] = loc; // prefer a real GPS fix; keep this in case none comes
                }
            }
            @Override public void onStatusChanged(String p, int s, Bundle b) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { }

            void deliver(Location loc) {
                done[0] = true;
                lm.removeUpdates(this);
                deliverLocation(id, toJson(loc, id));
            }
        };

        try {
            if (gpsOn) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 0, listener, Looper.getMainLooper());
            if (netOn) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0, 0, listener, Looper.getMainLooper());
        } catch (SecurityException e) {
            deliverLocation(id, error("denied"));
            return;
        }

        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (done[0]) return;
                done[0] = true;
                lm.removeUpdates(listener);
                deliverLocation(id, fallback[0] != null ? toJson(fallback[0], id) : error("timeout"));
            }
        }, FIX_TIMEOUT_MS);
    }

    private String toJson(Location loc, String id) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("lat", loc.getLatitude());
            o.put("lng", loc.getLongitude());
            o.put("acc", loc.hasAccuracy() ? loc.getAccuracy() : JSONObject.NULL);
            o.put("alt", loc.hasAltitude() ? loc.getAltitude() : JSONObject.NULL);
            o.put("ts", loc.getTime());
            o.put("provider", loc.getProvider());
            // Android's own verdict on this reading: set when it came from a
            // mock location provider (a Fake GPS app).
            boolean mock = Build.VERSION.SDK_INT >= 18 && loc.isFromMockProvider();
            // And whether a fake-location app is switched on in Developer
            // Options at all, even if this particular reading looks real.
            boolean mockApp = mockLocationAppSelected();
            boolean emulator = Attestation.isEmulator(this);
            boolean rooted = Attestation.isRooted(this);
            boolean virtualEnv = Attestation.inVirtualEnv(this);
            o.put("mock", mock);
            o.put("mockApp", mockApp);
            o.put("emu", emulator);
            o.put("root", rooted);
            o.put("virt", virtualEnv);
            // Signed so the server knows all of the above came from this app
            // and not from a page that defined window.IWMNative itself (026).
            if (Attestation.enabled()) {
                String nonce = locationNonces.containsKey(id) ? locationNonces.get(id) : "";
                String att = "v1|" + nonce + "|" + loc.getLatitude() + "|" + loc.getLongitude()
                    + "|" + (loc.hasAccuracy() ? String.valueOf(loc.getAccuracy()) : "") + "|" + loc.getTime()
                    + "|" + bit(mock) + "|" + bit(mockApp) + "|" + bit(emulator) + "|" + bit(rooted) + "|" + bit(virtualEnv);
                o.put("att", att);
                o.put("sig", Attestation.sign(att));
                o.put("kid", BuildInfo.GPS_KEY_ID);
            }
            return o.toString();
        } catch (Exception e) {
            return error("unavailable");
        }
    }

    private static String bit(boolean b) { return b ? "1" : "0"; }

    private String error(String code) {
        return "{\"ok\":false,\"error\":" + JSONObject.quote(code) + "}";
    }

    private void deliverLocation(String id, String json) {
        locationNonces.remove(id);
        if (web == null) return;
        web.evaluateJavascript("window.__iwmNativeLocation && window.__iwmNativeLocation(" + JSONObject.quote(id) + "," + json + ")", null);
    }

    /** Is any installed app currently allowed to act as the mock location provider? */
    @SuppressWarnings("deprecation")
    private boolean mockLocationAppSelected() {
        if (Build.VERSION.SDK_INT < 23) {
            return !"0".equals(Settings.Secure.getString(getContentResolver(), Settings.Secure.ALLOW_MOCK_LOCATION));
        }
        try {
            AppOpsManager ops = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
            List<PackageInfo> pkgs = getPackageManager().getInstalledPackages(PackageManager.GET_PERMISSIONS);
            for (PackageInfo p : pkgs) {
                if (p.requestedPermissions == null || p.packageName.equals(getPackageName())) continue;
                for (String perm : p.requestedPermissions) {
                    if (!"android.permission.ACCESS_MOCK_LOCATION".equals(perm)) continue;
                    int mode = ops.checkOpNoThrow("android:mock_location", p.applicationInfo.uid, p.packageName);
                    if (mode == AppOpsManager.MODE_ALLOWED) return true;
                }
            }
        } catch (Exception ignored) { }
        return false;
    }

    // ── tiny layout helpers for the two native screens ──────────────────
    private LinearLayout column() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(Color.WHITE);
        return box;
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(Color.rgb(15, 23, 42));
        if (bold) t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setPadding(0, 0, 0, (int) (12 * getResources().getDisplayMetrics().density));
        return t;
    }
}
