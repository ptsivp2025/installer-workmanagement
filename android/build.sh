#!/usr/bin/env bash
# Builds the installable APK without Gradle/Android Studio:
#   aapt (resources) → javac → dx (dex) → zipalign → apksigner
#
# Needs (Ubuntu): apt install android-sdk-platform-23 aapt zipalign apksigner dalvik-exchange
#
# Usage:
#   APP_URL=https://your-app.vercel.app ./build.sh     # server address built in
#   ./build.sh                                          # production URL (default below)
#   APP_URL= ./build.sh                                 # empty: app asks on first launch
#
# Signing: release.keystore + keystore.password in this folder, both
# gitignored. KEEP THEM SAFE AND BACKED UP. Android only installs an update
# over an existing install when it's signed with the same key. A new key
# means every phone has to uninstall the app first.
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="${APP_URL-https://installer-workmanagement.vercel.app}"
# Version comes from AndroidManifest.xml (bump versionCode + versionName there).
VERSION_CODE=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml)
VERSION=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
NOTES="${NOTES:-}"
SDK=/usr/lib/android-sdk
ANDROID_JAR="$SDK/platforms/android-23/android.jar"
OUT=build
KEYSTORE=release.keystore
# Key password: $KS_PASS, or android/keystore.password (gitignored). There's
# deliberately no default. Both files are kept out of git (.gitignore).
if [ -z "${KS_PASS:-}" ] && [ -f keystore.password ]; then KS_PASS=$(tr -d '\n' < keystore.password); fi
[ -n "${KS_PASS:-}" ] || { echo "Set KS_PASS or create android/keystore.password (see README)"; exit 1; }

# Never make a new signing key by accident: an APK signed with a different
# key can't update the app already on the installers' phones, every one of
# them would have to uninstall first.
if [ ! -f "$KEYSTORE" ] && [ "${NEW_KEYSTORE:-}" != "1" ]; then
  echo "android/$KEYSTORE not found. Copy the existing release key (and keystore.password) here first."
  echo "Only for a deliberately brand-new key: NEW_KEYSTORE=1 ./build.sh"
  exit 1
fi

# GPS signing key (migration 026): the app signs every GPS reading with it so
# the server can tell the real app from a web page pretending to be it. Like
# the keystore: gitignored, keep a backup. Made on the first build; the
# server needs the same key once (see gps-key.sql printed at the end).
GPS_KEY_FILE=gps.key
[ -f "$GPS_KEY_FILE" ] || python3 -c "import secrets; print(secrets.token_hex(32))" > "$GPS_KEY_FILE"
GPS_KEY=$(tr -d '\n\r' < "$GPS_KEY_FILE")
GPS_KEY_ID=$(printf '%s' "$GPS_KEY" | sha256sum | cut -c1-8)

rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/gensrc/com/iwm/app"

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

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F "$OUT/app.unsigned.apk"

javac -nowarn --release 8 -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$OUT/obj" \
  $(find src "$OUT/gen" "$OUT/gensrc" -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
test -f "$OUT/obj/com/iwm/app/MainActivity.class"

dalvik-exchange --dex --min-sdk-version=21 --output="$OUT/classes.dex" "$OUT/obj"
(cd "$OUT" && aapt add app.unsigned.apk classes.dex >/dev/null)

zipalign -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

if [ ! -f "$KEYSTORE" ]; then # only reached with NEW_KEYSTORE=1 (checked above)
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias iwm \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Installer Work Management, O=IWM, C=ID" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias iwm --out "$OUT/installer-wm.apk" "$OUT/app.aligned.apk"
apksigner verify "$OUT/installer-wm.apk"
# Publish for in-app updates: deploying the web app ships these two files,
# and every installed copy picks the new version up on its next launch.
PUBLISH=../public/app
mkdir -p "$PUBLISH"
cp "$OUT/installer-wm.apk" "$PUBLISH/installer-wm.apk"
python3 - "$PUBLISH/version.json" "$VERSION_CODE" "$VERSION" "$NOTES" <<'PY'
import json, sys
path, code, name, notes = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
json.dump({"versionCode": code, "versionName": name, "apk": "/app/installer-wm.apk", "notes": notes, "required": False},
          open(path, "w"), indent=2)
PY
echo "Built $OUT/installer-wm.apk (url: ${APP_URL:-<asked on first launch>}, version $VERSION)"

# The server side of the GPS key. Kept out of the terminal log and out of git
# (build/ is ignored). Run it once per key in the Supabase SQL Editor, AFTER
# the installers have this app version (see README → Android app).
printf "INSERT INTO public.app_attestation_keys (key_id, secret) VALUES ('%s', '%s') ON CONFLICT (key_id) DO NOTHING;\n" \
  "$GPS_KEY_ID" "$GPS_KEY" > "$OUT/gps-key.sql"
echo "GPS key id $GPS_KEY_ID. Server SQL: android/$OUT/gps-key.sql"
