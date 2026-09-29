#!/usr/bin/env bash
# Builds the installable APK without Gradle/Android Studio:
#   aapt (resources) → javac → d8/dx (dex) → zipalign → apksigner
#
# Runs on Windows (Git Bash, Android SDK from Android Studio: ANDROID_HOME or
# %LOCALAPPDATA%/Android/Sdk) or Ubuntu
#   (apt install android-sdk-platform-23 aapt zipalign apksigner dalvik-exchange).
#
# Usage:
#   android/build.sh                                    # production URL (default below)
#   APP_URL=https://your-app.vercel.app android/build.sh
#   APP_URL= android/build.sh                           # empty: app asks on first launch
#
# Secrets live OUTSIDE the repository (the repo has a public copy), in
# SECRETS_DIR (default ~/installer-android-rahasia):
#   release.keystore + keystore.password   APK signing key. Android only
#       installs an update over an existing app signed with the same key.
#   gps.key   signs every GPS reading (migration 026); the database needs the
#       same key once (build/gps-key.sql).
# KEEP THAT FOLDER BACKED UP.
#
# The APK is NOT copied into public/: it carries the GPS key, and anything in
# public/ is downloadable by anyone. Upload build/installer-wm.apk in Admin
# Panel → Aplikasi Android (private storage, signed-in users only).
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="${APP_URL-https://installer-workmanagement.vercel.app}"
VERSION_CODE=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml)
VERSION=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
SECRETS_DIR="${SECRETS_DIR:-$HOME/installer-android-rahasia}"
KEYSTORE="$SECRETS_DIR/release.keystore"
OUT=build

# ── Toolchain ─────────────────────────────────────────────────────────────
SDK_WIN="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}"
if [ -d "$SDK_WIN/build-tools" ]; then
  BT="$SDK_WIN/build-tools/$(ls "$SDK_WIN/build-tools" | grep -v rc | sort -V | tail -1)"
  ANDROID_JAR="$SDK_WIN/platforms/$(ls "$SDK_WIN/platforms" | grep -E '^android-[0-9]+$' | sort -V | tail -1)/android.jar"
  AAPT="$BT/aapt"; ZIPALIGN="$BT/zipalign"
  APKSIGNER="$BT/apksigner"; [ -f "$APKSIGNER.bat" ] && APKSIGNER="$BT/apksigner.bat"
  D8="$BT/d8";               [ -f "$D8.bat" ] && D8="$BT/d8.bat"
  KEYTOOL=keytool; command -v keytool >/dev/null || KEYTOOL="$(ls -d "/c/Program Files/Java/"*/bin/keytool.exe 2>/dev/null | tail -1)"
else
  SDK=/usr/lib/android-sdk
  ANDROID_JAR="$SDK/platforms/android-23/android.jar"
  AAPT=aapt; ZIPALIGN=zipalign; APKSIGNER=apksigner; D8=""; KEYTOOL=keytool
fi
# Native Windows tools want Windows paths.
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

# ── Secrets ───────────────────────────────────────────────────────────────
if [ ! -f "$KEYSTORE" ]; then
  echo "$KEYSTORE not found."
  echo "Put the existing release key (and keystore.password) in $SECRETS_DIR first: an APK signed with"
  echo "a different key can't update the app already on the installers' phones."
  exit 1
fi
KS_PASS="${KS_PASS:-$(tr -d '\n\r' < "$SECRETS_DIR/keystore.password")}"
[ -f "$SECRETS_DIR/gps.key" ] || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$SECRETS_DIR/gps.key"
GPS_KEY=$(tr -d '\n\r' < "$SECRETS_DIR/gps.key")
GPS_KEY_ID=$(printf '%s' "$GPS_KEY" | sha256sum | cut -c1-8)

rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/gensrc/com/iwm/app" "$OUT/dex"

# Values baked into the app. An empty APP_URL means "ask on first launch".
cat > "$OUT/gensrc/com/iwm/app/BuildInfo.java" <<EOF
package com.iwm.app;
final class BuildInfo {
    static final String APP_URL = "${APP_URL%/}";
    static final String VERSION = "${VERSION}";
    static final String GPS_KEY = "${GPS_KEY}";
    static final String GPS_KEY_ID = "${GPS_KEY_ID}";
}
EOF

"$AAPT" package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$(winpath "$ANDROID_JAR")" -F "$OUT/app.unsigned.apk"

javac -nowarn --release 8 -encoding UTF-8 -classpath "$(winpath "$ANDROID_JAR")" -d "$OUT/obj" \
  $(find src "$OUT/gen" "$OUT/gensrc" -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
test -f "$OUT/obj/com/iwm/app/MainActivity.class"

if [ -n "$D8" ]; then
  "$D8" --release --min-api 21 --lib "$(winpath "$ANDROID_JAR")" --output "$(winpath "$OUT/dex")" $(find "$OUT/obj" -name '*.class') >/dev/null
  cp "$OUT/dex/classes.dex" "$OUT/classes.dex"
else
  dalvik-exchange --dex --min-sdk-version=21 --output="$OUT/classes.dex" "$OUT/obj"
fi
(cd "$OUT" && "$AAPT" add app.unsigned.apk classes.dex >/dev/null)

"$ZIPALIGN" -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"
"$APKSIGNER" sign --ks "$(winpath "$KEYSTORE")" --ks-pass "pass:$KS_PASS" --ks-key-alias iwm \
  --out "$OUT/installer-wm.apk" "$OUT/app.aligned.apk"
"$APKSIGNER" verify "$OUT/installer-wm.apk"

# The server side of the GPS key, for the Supabase SQL Editor (once per key,
# AFTER the installers have this app). Kept out of git (build/ is ignored).
printf "INSERT INTO public.app_attestation_keys (key_id, secret) VALUES ('%s', '%s') ON CONFLICT (key_id) DO NOTHING;\n" \
  "$GPS_KEY_ID" "$GPS_KEY" > "$OUT/gps-key.sql"

echo "Built android/$OUT/installer-wm.apk — version $VERSION (code $VERSION_CODE), url ${APP_URL:-<asked on first launch>}"
echo "Next: Admin Panel → Aplikasi Android → upload it. GPS key id $GPS_KEY_ID, server SQL: android/$OUT/gps-key.sql"
