# Mobile App: Building an Executable

How to turn the generated Expo app (`mobile/`, see [mobile-app.md](mobile-app.md)) into an installable
Android `.apk`, what iOS needs, how the app finds its API, and which app configuration the generator does
not emit yet.

Each step carries a label:

- **verified**: run end to end on a Linux (WSL2) host while writing this page.
- **read**: taken from the linked official documentation or from the generator source, not run.
- **not run**: described, never executed.

## Host setup (Ubuntu on WSL2)

The tools are installed by hand. They are not npm packages, so there is no `package.json` line to bump: the JDK
and system libraries come from apt (root), the Android SDK from Google's `sdkmanager`, and the SDK versions are
dictated by the React Native version in `mobile/package.json`. No setup script is generated; follow these
steps once per host. All steps below are verified unless marked otherwise.

### 1. JDK

```bash
sudo apt install default-jdk        # Ubuntu 26.04: openjdk-25-jdk
echo 'export JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64' >> ~/.bashrc
```

Gradle 9.4 runs on JDK 25. React Native documents JDK 17; try it if a build fails with a Java error.

Set `JAVA_HOME` in `~/.bashrc`, not by `source /etc/environment`. That file holds a full
`PATH="/usr/local/sbin:..."` line, so sourcing it **replaces** `PATH` in the current shell and drops nvm's
`~/.nvm/versions/node/*/bin`: `npm` and `node` are "not found" until a new terminal is opened.

### 2. Android command-line tools

Download "Command line tools only" for Linux from <https://developer.android.com/studio#command-tools>.

```bash
sudo apt install unzip
mkdir -p ~/Android/Sdk/cmdline-tools
unzip commandlinetools-linux-*_latest.zip -d ~/Android/Sdk/cmdline-tools
mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
```

Add to `~/.bashrc`:

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
```

Then **open a new terminal**. A terminal opened before the edit has no `sdkmanager` on `PATH`.

- Do not `apt install sdkmanager` to fix "command not found". That package is a different program, and run as
  `sudo sdkmanager` it is the one that runs (sudo's own `PATH`). The SDK lives in a directory you own
  (`~/Android/Sdk`), and Google's `sdkmanager` needs no `sudo` there.
- Do not `apt install google-android-emulator-installer` either. It puts `/usr/bin/emulator` (an SDK under
  `/usr/lib/android-sdk`) ahead of `$ANDROID_HOME/emulator`, so `emulator -avd` starts the wrong emulator.
  `type -a sdkmanager emulator` must list `~/Android/Sdk/...` first.

### 3. SDK packages

The versions come from React Native's version catalog. Read them after `npm install` in `mobile/`:

```bash
grep -E '^(minSdk|targetSdk|compileSdk|buildTools|ndk) *=' mobile/node_modules/react-native/gradle/libs.versions.toml
```

For React Native 0.88 (Expo 58) that is compileSdk 37, targetSdk 36, minSdk 24, build tools 37.0.0. The NDK version
is `27.1.12297006`.

```bash
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006"
sdkmanager --licenses
```

- The platform package is named `platforms;android-37.0`, not `platforms;android-37`. Check the exact name with
  `sdkmanager --list | grep 'platforms;android-37'`.
- Run `sdkmanager --licenses` **after** installing and accept every license. Running it only before the
  install was not enough.
- With the licenses accepted, Gradle downloads what the build needs beyond this list on the first build (on
  this host: `build-tools;36.0.0` and `cmake;3.22.1`).

### 4. Emulator

```bash
sdkmanager "emulator" "system-images;android-36;google_apis;x86_64"
sudo apt install libpulse0                    # qemu-system-x86_64 fails to load libpulse.so.0 without it
sudo usermod -aG kvm $USER                    # then, in Windows PowerShell: wsl --shutdown
avdmanager create avd -n pixel36 -k "system-images;android-36;google_apis;x86_64" -d pixel_7
```

- An x86_64 emulator needs hardware acceleration: read and write access to `/dev/kvm` (group `kvm`). WSL2
  exposes `/dev/kvm` as `root:kvm`. The new group takes effect after `wsl --shutdown` and a new WSL session.
  Without it the emulator stops with `x86_64 emulation currently requires hardware acceleration!`. Software
  emulation (`-accel off`) did not finish booting in 23 minutes and is not usable.
- `avdmanager` prints `Error: Could not load devices from .../system-images/android-36/google_apis/x86_64/devices.xml`.
  Phone images ship no `devices.xml`, and the AVD is created anyway. Check with `emulator -list-avds`.
- On a host whose user is not in the `kvm` group, only the APK build works.

## Android `.apk`

The build needs no Expo account and no external build service. It uses the JDK, the Android SDK and NDK
from Google's hosts, and Gradle.

| Step | Command (from `mobile/`) | Status |
|---|---|---|
| Install dependencies | `npm install` | verified |
| Generate the native project | `npx expo prebuild --platform android` | verified |
| Build a release APK | `cd android && ./gradlew assembleRelease` | verified: `BUILD SUCCESSFUL in 15m 5s`, 547 tasks, cold Gradle home |
| Build a debug APK | `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64` | verified: 12m 13s, 80 MB |
| Start the emulator | `emulator -avd pixel36 &`, then `adb devices` lists `emulator-5554` | verified |
| Install on an emulator or device | `adb install -r android/app/build/outputs/apk/release/app-release.apk` | verified |
| Launch and reach the login screen | start the app on the device | verified for the debug APK with Metro; the release APK against a deployed HTTPS API is not run yet (see [below](#release-apk-against-a-deployed-api)) |

Facts about the result:

- The release APK is `android/app/build/outputs/apk/release/app-release.apk`, 65,160,862 bytes, application id
  `com.anonymous.generatedapp`, version code 1, version name 1.0.0 (verified).
- `expo prebuild` writes `android/app/build.gradle` so the release build is signed with the debug keystore
  (`signingConfig signingConfigs.debug`, verified by reading the generated file). Such an APK installs
  by sideloading but cannot be uploaded to the Play Store. A store release needs its own keystore.
- A debug APK loads its JavaScript from a running Metro server (`npx expo start` plus
  `adb reverse tcp:8081 tcp:8081`). A release APK carries the bundled JavaScript and starts on its own:
  it needs neither Metro nor `adb reverse`.
- Pass `-PreactNativeArchitectures=x86_64` for an x86_64 emulator; omit it for a build that covers every device
  architecture (larger and slower).
- The build host needs about 12 GB for the SDK and NDK and 3.5 GB for the Gradle home.
- Every generated app has the same application id (see [the gaps below](#app-configuration-the-generator-does-not-emit)),
  so installing the APK of one consumer project replaces the app of another on the same device.

### Installing on an Android phone (not run)

Sideload the release APK: connect the phone with USB debugging enabled and run `adb install`, or copy the file
to the phone and open it after allowing installs from that source. Expo describes the same two routes for an
internal-distribution APK: <https://docs.expo.dev/build/internal-distribution/> (read). From WSL2, a USB phone
needs `usbipd-win` on the Windows side; Android 11+ wireless debugging (`adb pair`, `adb connect`) avoids USB.

### Using the emulator

The emulator runs inside WSL2. WSLg shows its window on the Windows desktop, and `adb` finds it without any
connect step. Use ports 5554 to 5584 for the emulator console so `adb devices` finds it.

Text input:

- **The on-screen keyboard does not open in most text fields; only a small vertical toolbar (microphone,
  backspace, check, emoji, menu) appears. Password fields get the full keyboard.** This is Gboard's stylus
  handwriting mode ("Write in text fields", on by default on Android 14+), which the emulator's pointer input
  triggers. Password fields are excluded from handwriting, which is why they behave. It is not an app bug.
  Turn it off:
  ```bash
  adb shell settings put secure stylus_handwriting_enabled 0
  ```
  The menu button on the toolbar also switches back to the keyboard for the moment.
- The AVD is created with `hw.keyboard=no`, so the PC keyboard does not type into the app. Set `hw.keyboard=yes`
  in `~/.android/avd/<name>.avd/config.ini` and restart the emulator to type with the PC keyboard.
- The emulator shares the host clipboard; Gboard offers its content as a suggestion.

When the app closes right after it starts, read the reason with `adb logcat -d -b crash`. A JavaScript error is
reported as `com.facebook.react.common.JavascriptException: Error: <message>`.

### EAS Build instead of a local build (not run)

`eas build --platform android --profile preview` builds on Expo's servers and needs an Expo account and an
`eas.json` with the profile (see the gaps below). `distribution: "internal"` makes the build an APK instead of an
AAB (read: <https://docs.expo.dev/build/internal-distribution/>). `eas build --local` runs the same build on
the host.

## iOS (future steps, not run)

Producing and installing an iOS build is not covered by a verified run. These are the routes and what each needs:

| Route | Needs | Source |
|---|---|---|
| Ad hoc build installed on registered iPhones | Paid Apple Developer Program membership, the device UDID registered with `eas device:create`, an EAS build; a new device needs a rebuild or `eas build:resign`; at most 100 iPhones per year | <https://docs.expo.dev/build/internal-distribution/> |
| Local iOS build | A Mac with Xcode | <https://docs.expo.dev/get-started/set-up-your-environment/> |
| Expo Go on the iPhone against a development server | Per Expo's current setup page, an Apple Developer Program membership and TestFlight; Expo calls Expo Go a playground that is not meant for production projects | <https://docs.expo.dev/get-started/set-up-your-environment/> |

Expo Go cannot check an app that needs native modules outside Expo Go's bundled set. The generated app uses
`expo-secure-store`, `expo-local-authentication` and `expo-document-picker`; check the SDK version of the app against
the Expo Go version before relying on it. A development build covers all of them.

Expo Go does not apply the biometric lock to the refresh token: its own `Info.plist` has no
`NSFaceIDUsageDescription`, so `lib/token-storage.ts` stores and reads the token unlocked when
`Constants.executionEnvironment` is `storeClient`. Sign-in works there, but Face ID cannot be checked in Expo Go.
A standalone or development build locks the token as usual; `expo prebuild --platform ios` writes
`NSFaceIDUsageDescription` into its `Info.plist` through the `expo-secure-store` plugin in `app.json`.

## Pointing the app at an API

`EXPO_PUBLIC_API_BASE_URL` is the only API setting (`lib/api-base.ts`). Expo inlines it into the JavaScript
bundle when the app is bundled, so set it for the build (or for Metro), not on the phone.

- A build that is not a development build throws at start when the value does not begin with `https://`. A
  release APK therefore needs an HTTPS URL. A release APK built without the value closes right after start with
  `EXPO_PUBLIC_API_BASE_URL must be https:// in production` in `adb logcat -b crash` (verified).
- The URL must be reachable from the phone. `localhost` on a phone is the phone itself.
- Do not end the value with `/`. The code appends paths such as `/api/mobile/auth/token`, so a trailing slash
  produces `//api/...`.
- Native iOS and Android requests are not subject to CORS ([mobile-app.md](mobile-app.md#running-and-testing));
  CORS applies only to the Expo web bundle in a browser.
- Login uses the mobile token routes under `/api/mobile/auth/`; see [mobile-app.md](mobile-app.md#authentication).
  The deployment must include them, and a Vercel deployment behind Deployment Protection rejects the app's requests (read).

### Debug APK against a local server

Verified: the debug APK on the emulator signed in to and used a local server. The commands below are the
documented way to do it (read); the exact URL used in that run is not recorded.

The debug APK gets its JavaScript, and with it the URL, from Metro, so changing the URL needs no rebuild,
only a Metro restart. A debug build allows plain HTTP (`usesCleartextTraffic` in the debug manifest).

```bash
# from mobile/, with the web app running on port 3000 of the WSL host
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000 npx expo start
adb reverse tcp:8081 tcp:8081
```

`10.0.2.2` is the emulator's alias for the host's `localhost`. Alternatively run `adb reverse tcp:3000 tcp:3000` and use
`http://localhost:3000`.

### Release APK against a deployed API

Write the URL to `mobile/.env`, which the Expo CLI reads when it bundles:

```bash
echo 'EXPO_PUBLIC_API_BASE_URL=https://staging.example.com' > mobile/.env
cd mobile/android
./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease
```

**Gradle does not treat `mobile/.env` as an input of the bundle task.** After changing only `.env`, a plain
`./gradlew assembleRelease` can keep the previous `index.android.bundle` and the previous APK (verified: the
bundle and APK were older than `.env`, and the URL was not in the bundle). `--rerun` forces the bundle task to run
again (not run yet). If that does not help, delete `android/app/build` and build again.

Check the URL is in the APK before installing it:

```bash
unzip -p app/build/outputs/apk/release/app-release.apk assets/index.android.bundle | strings | grep -c staging.example.com
```

A count of 0 means the bundle does not carry the URL, and the app will close at start.

To test a release APK against a local server, put an HTTPS tunnel (for example cloudflared or ngrok) in
front of it and build with the tunnel's URL (not run).

## App configuration the generator does not emit

`templates/mobile/app.json.jinja2` writes `name`, `slug`, `version`, `orientation`, `platforms`, `plugins`,
`scheme` and `web.bundler`. The following is missing, and `expo prebuild` fills some of it with defaults:

| Missing | Effect |
|---|---|
| `android.package` | `expo prebuild` writes `com.anonymous.generatedapp` (verified); every generated app gets the same id |
| `ios.bundleIdentifier` | An iOS build cannot be signed without one |
| `ios.buildNumber`, `android.versionCode` | The version code stays 1 (verified) |
| `icon`, `splash` / splash plugin | The default Expo launcher icon is used (verified: `ic_launcher.webp`) |
| `extra.eas.projectId`, `owner` | Needed by `eas build` for a linked project |
| `runtimeVersion`, `updates` | Needed only for over-the-air updates |
| `eas.json` | No template exists. `build.preview` with `distribution: "internal"` is the minimal profile (read) |
| `expo-dev-client` dependency | Not in `package.json.jinja2`; a development build is not available without it |

None of these is implemented. Release signing (a keystore and its secrets) is never generated.
