package com.iwm.app;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app update for a sideloaded APK (no Play Store to do it for us).
 *
 * The web app publishes public/app/version.json and public/app/installer-wm.apk
 * (android/build.sh writes both). On every launch, and from the "Cek Update
 * Aplikasi" menu item, this compares the published versionCode with the
 * installed one. If newer, it offers the update, downloads it with
 * DownloadManager (with progress) and hands it to Android's installer.
 * Android asks the user once to allow installs from this app.
 */
class UpdateChecker {
    private static final String APK_MIME = "application/vnd.android.package-archive";

    private final MainActivity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean busy;

    UpdateChecker(MainActivity activity) { this.activity = activity; }

    void check(final String baseUrl, final boolean manual) {
        if (busy || baseUrl == null || baseUrl.length() == 0) return;
        busy = true;
        if (manual) toast("Memeriksa update…");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    final JSONObject info = new JSONObject(get(baseUrl + "/app/version.json?t=" + System.currentTimeMillis()));
                    final int latest = info.getInt("versionCode");
                    final int installed = installedVersionCode();
                    handler.post(new Runnable() {
                        @Override public void run() {
                            busy = false;
                            if (latest > installed) offer(baseUrl, info);
                            else if (manual) toast("Aplikasi sudah versi terbaru (v" + BuildInfo.VERSION + ")");
                        }
                    });
                } catch (final Exception e) {
                    handler.post(new Runnable() {
                        @Override public void run() {
                            busy = false;
                            if (manual) toast("Gagal memeriksa update. Periksa koneksi internet.");
                        }
                    });
                }
            }
        }).start();
    }

    private void offer(final String baseUrl, JSONObject info) {
        final String name = info.optString("versionName", "?");
        String notes = info.optString("notes", "");
        String apk = info.optString("apk", "/app/installer-wm.apk");
        final String apkUrl = (apk.startsWith("http") ? apk : baseUrl + apk) + "?v=" + info.optInt("versionCode");
        boolean required = info.optBoolean("required", false);

        AlertDialog.Builder b = new AlertDialog.Builder(activity)
            .setTitle("Update tersedia")
            .setMessage("Versi " + name + " sudah tersedia (terpasang: v" + BuildInfo.VERSION + ")."
                + (notes.length() > 0 ? "\n\n" + notes : ""))
            .setPositiveButton("Update Sekarang", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) { download(apkUrl, name); }
            });
        if (required) b.setCancelable(false);
        else b.setNegativeButton("Nanti", null);
        b.show();
    }

    private void download(String apkUrl, String name) {
        final DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        final String fileName = "installer-wm-" + name + ".apk";
        final File target = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
        if (target.exists()) target.delete(); // otherwise DownloadManager saves "-1.apk" beside it

        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(apkUrl));
        r.setTitle("Installer WM " + name);
        r.setMimeType(APK_MIME);
        r.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName);
        r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        final long id = dm.enqueue(r);

        @SuppressWarnings("deprecation")
        final ProgressDialog progress = new ProgressDialog(activity);
        progress.setTitle("Mengunduh update…");
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progress.setMax(100);
        progress.setCancelable(false);
        progress.setButton(DialogInterface.BUTTON_NEGATIVE, "Batal", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int w) { dm.remove(id); }
        });
        progress.show();

        // Polling instead of a download-complete receiver: registering one
        // needs an API 33 method this API 23 build can't call.
        handler.post(new Runnable() {
            @Override public void run() {
                if (!progress.isShowing()) return; // cancelled
                Cursor c = dm.query(new DownloadManager.Query().setFilterById(id));
                if (c == null || !c.moveToFirst()) { if (c != null) c.close(); progress.dismiss(); toast("Unduhan dibatalkan."); return; }
                int status = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                long done = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                c.close();
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    progress.dismiss();
                    install(dm, id, target);
                } else if (status == DownloadManager.STATUS_FAILED) {
                    progress.dismiss();
                    toast("Unduhan gagal. Coba lagi.");
                } else {
                    if (total > 0) progress.setProgress((int) (done * 100 / total));
                    handler.postDelayed(this, 400);
                }
            }
        });
    }

    private void install(DownloadManager dm, long id, File file) {
        Uri uri = Build.VERSION.SDK_INT >= 24 ? dm.getUriForDownloadedFile(id) : Uri.fromFile(file);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, APK_MIME);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(i);
        } catch (Exception e) {
            toast("Tidak bisa membuka installer. Buka file dari notifikasi unduhan.");
        }
    }

    @SuppressWarnings("deprecation")
    private int installedVersionCode() throws Exception {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionCode;
    }

    private static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) sb.append(line);
            in.close();
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }

    private void toast(String msg) { Toast.makeText(activity, msg, Toast.LENGTH_LONG).show(); }
}
