package com.iwm.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the camera app a place to write the full-size photo, and hands the
 * WebView the same file back as the <input type=file> result.
 *
 * Files live in this app's private cache. Access is granted per photo by
 * the intent's URI-permission flags, so no storage permission is needed
 * and nothing lands in the phone's gallery. A tiny stand-in for androidx
 * FileProvider (this project builds without Gradle/androidx).
 */
public class CameraProvider extends ContentProvider {
    static final String AUTHORITY = "com.iwm.app.camera";

    static File dir(android.content.Context ctx) {
        File d = new File(ctx.getCacheDir(), "camera");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTHORITY + "/" + f.getName());
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException("bad path");
        return new File(dir(getContext()), name);
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor c = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        try {
            File f = fileFor(uri);
            c.addRow(new Object[] { f.getName(), f.length() });
        } catch (FileNotFoundException ignored) { }
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
