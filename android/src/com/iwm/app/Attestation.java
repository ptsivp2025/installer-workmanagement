package com.iwm.app;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.util.Locale;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * What the server can't see for itself (migration 026): whether this copy of
 * the app runs on an emulator, a rooted phone or inside a cloning app, and a
 * signature proving a GPS reading really came from this app rather than a
 * web page pretending to be it.
 *
 * The signing key is baked in at build time (android/gps.key via build.sh)
 * and never committed. The checks are the well-known ones: they stop the
 * usual tools (BlueStacks/LDPlayer/Nox, Magisk/SuperSU, Parallel Space),
 * not someone who rebuilds the phone's system image to hide.
 */
final class Attestation {
    private Attestation() { }

    static boolean enabled() { return BuildInfo.GPS_KEY.length() > 0; }

    /** HMAC-SHA256 of the payload as lowercase hex; iwm_attestation_valid() recomputes it. */
    static String sign(String payload) { return hmacHex(BuildInfo.GPS_KEY, payload); }

    static String hmacHex(String key, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes("UTF-8"), "HmacSHA256"));
            byte[] out = mac.doFinal(payload.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder(out.length * 2);
            for (byte b : out) {
                hex.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // None of these change while the app is open, so each is worked out once.
    private static Boolean emulator, rooted, virtualEnv;

    // ── emulator ─────────────────────────────────────────────────────────
    private static final String[] EMULATOR_FILES = {
        "/dev/socket/qemud", "/dev/qemu_pipe", "/sys/qemu_trace", "/system/bin/qemu-props",
        "/system/lib/libc_malloc_debug_qemu.so",
        "/dev/socket/genyd", "/dev/socket/baseband_genyd",                        // Genymotion
        "/system/bin/nox-prop", "/system/bin/nox-vbox-sf", "/system/lib/libnoxspeedup.so", // Nox
        "/system/bin/ldinit", "/system/bin/ldmountsf", "/system/lib/libldutils.so",  // LDPlayer
        "/data/.bluestacks.prop", "/system/bin/bstshutdown", "/system/bin/bstsvcmgrtest", // BlueStacks
        "/system/bin/microvirt-prop", "/system/bin/microvirtd",                   // MEmu
        "/system/bin/ttVM-prop", "/system/lib/libdroid4x.so", "/system/bin/windroyed", "/system/bin/androVM-prop",
    };
    private static final String[] EMULATOR_PACKAGES = {
        "com.bluestacks.home", "com.bluestacks.settings", "com.bluestacks.appmart", "com.bignox.app",
        "com.ldmnq.launcher3", "com.microvirt.launcher", "com.microvirt.guide", "com.mumu.launcher",
        "com.netease.nemu_vinput.nemu", "com.vphone.launcher",
    };

    static synchronized boolean isEmulator(Context c) {
        if (emulator == null) emulator = detectEmulator(c);
        return emulator;
    }

    private static boolean detectEmulator(Context c) {
        String fp = lower(Build.FINGERPRINT), model = lower(Build.MODEL), product = lower(Build.PRODUCT);
        String hw = lower(Build.HARDWARE), manufacturer = lower(Build.MANUFACTURER);
        String brand = lower(Build.BRAND), device = lower(Build.DEVICE);
        if (fp.startsWith("generic") || fp.contains("vbox") || fp.contains("sdk_gphone")) return true;
        if (model.contains("google_sdk") || model.contains("emulator") || model.contains("android sdk built for")) return true;
        if (manufacturer.contains("genymotion") || (brand.startsWith("generic") && device.startsWith("generic"))) return true;
        if (product.equals("sdk") || product.startsWith("sdk_") || product.contains("google_sdk") || product.contains("sdk_gphone")
            || product.contains("vbox86p") || product.contains("emulator") || product.contains("simulator")) return true;
        if (hw.equals("goldfish") || hw.equals("ranchu") || hw.contains("vbox86") || hw.contains("nox") || hw.contains("ttvm")) return true;
        for (String f : EMULATOR_FILES) if (new File(f).exists()) return true;
        for (String p : EMULATOR_PACKAGES) if (installed(c, p)) return true;
        return false;
    }

    // ── root ─────────────────────────────────────────────────────────────
    // Root matters because root tools (Magisk + LSPosed modules) can hide a
    // Fake GPS app from Android's own isFromMockProvider() check.
    private static final String[] SU_PATHS = {
        "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su", "/data/local/xbin/su",
        "/data/local/bin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
        "/system/xbin/daemonsu", "/sbin/.magisk", "/cache/.disable_magisk", "/dev/.magisk.unblock",
    };
    private static final String[] ROOT_PACKAGES = {
        "com.topjohnwu.magisk", "io.github.huskydg.magisk", "io.github.vvb2060.magisk", "eu.chainfire.supersu",
        "com.noshufou.android.su", "com.koushikdutta.superuser", "com.kingroot.kinguser", "com.kingo.root",
        "me.weishu.kernelsu", "me.bmax.apatch", "org.lsposed.manager", "de.robv.android.xposed.installer",
        "com.saurik.substrate",
    };

    static synchronized boolean isRooted(Context c) {
        if (rooted == null) rooted = detectRoot(c);
        return rooted;
    }

    private static boolean detectRoot(Context c) {
        String tags = Build.TAGS;
        if (tags != null && tags.contains("test-keys")) return true;
        for (String p : SU_PATHS) if (new File(p).exists()) return true;
        for (String p : ROOT_PACKAGES) if (installed(c, p)) return true;
        return false;
    }

    // ── cloning apps ─────────────────────────────────────────────────────
    // Parallel Space, VirtualXposed and the like run this app inside their
    // own process and can hand it any location. Its data directory then
    // sits inside theirs instead of where Android puts an app's own data.
    // (Android's own dual-app / work-profile copies live under
    // /data/user/<n>/ and pass.)
    static synchronized boolean inVirtualEnv(Context c) {
        if (virtualEnv == null) {
            String dir = c.getFilesDir().getAbsolutePath();
            String pkg = Pattern.quote(c.getPackageName());
            virtualEnv = !dir.matches("(/data/data|/data/user/\\d+|/data/user_de/\\d+|/mnt/expand/[^/]+/user/\\d+)/" + pkg + "/files");
        }
        return virtualEnv;
    }

    private static boolean installed(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String lower(String s) { return s == null ? "" : s.toLowerCase(Locale.ROOT); }
}
