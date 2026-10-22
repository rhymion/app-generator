# Mobile App: Building an Executable

How to turn the generated Expo app (`mobile/`, see [mobile-app.md](mobile-app.md)) into an installable
Android `.apk`, what iOS needs, how the app finds its API, and which app configuration the generator does
not emit yet.

Each step carries a label:

- **verified**: run end to end on a Linux (WSL2) host while writing this page.
- **read**: taken from the linked official documentation or from the generator source, not run.
- **not run**: described, never executed.

## Android `.apk`

The build needs no Expo account and no external build service. It uses the JDK, the Android SDK and NDK
from Google's hosts, and Gradle.

| Step | Command (from `mobile/`) | Status |
|---|---|---|
| Install dependencies | `npm install` | verified |
| Generate the native project | `npx expo prebuild --platform android` | verified |
| Build a release APK | `cd android && ./gradlew assembleRelease` | verified: `BUILD SUCCESSFUL in 15m 5s`, 547 tasks, cold Gradle home |
| Build a debug APK | `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64` | verified: 12m 13s, 80 MB |
| Install on an emulator or device | `adb install android/app/build/outputs/apk/release/app-release.apk` | not run |
| Launch and reach the login screen | start the app on the device | not run |

Facts about the result:

- The release APK is `android/app/build/outputs/apk/release/app-release.apk`, 65,160,862 bytes, application id
  `com.anonymous.generatedapp`, version code 1, version name 1.0.0 (verified).
- `expo prebuild` writes `android/app/build.gradle` so the release build is signed with the debug keystore
  (`signingConfig signingConfigs.debug`, verified by reading the generated file). Such an APK installs
  by sideloading but cannot be uploaded to the Play Store. A store release needs its own keystore.
- A debug APK loads its JavaScript from a running Metro server (`npx expo start` plus
  `adb reverse tcp:8081 tcp:8081`). A release APK carries the bundled JavaScript and starts on its own (read).
- Pass `-PreactNativeArchitectures=x86_64` for an x86_64 emulator; omit it for a build that covers every device
  architecture (larger and slower).
- The build host needs about 12 GB for the SDK and NDK and 3.5 GB for the Gradle home.

### Installing on an Android phone (not run)

Sideload the release APK: connect the phone with USB debugging enabled and run `adb install`, or copy the file
to the phone and open it after allowing installs from that source. Expo describes the same two routes for an
internal-distribution APK: <https://docs.expo.dev/build/internal-distribution/> (read).

### Installing on an emulator

An x86_64 emulator needs hardware acceleration. On a Linux host the user needs read and write access to
`/dev/kvm` (membership of group `kvm`); without it the emulator stops with
`x86_64 emulation currently requires hardware acceleration!`. Software emulation (`-accel off`) did not finish
booting in 23 minutes and is not usable. The emulator step is not run for this reason. Use ports 5554 to 5584
for the emulator console so `adb devices` finds it.

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
bundle when the app is bundled, so set it for the build, not on the phone.

- A build that is not a development build throws at start when the value does not begin with `https://`. A
  release APK therefore needs an HTTPS URL (read: `lib/api-base.ts`).
- The URL must be reachable from the phone. `localhost` on a phone is the phone itself. Use a deployed
  staging URL.
- Native iOS and Android requests are not subject to CORS ([mobile-app.md](mobile-app.md#running-and-testing));
  CORS applies only to the Expo web bundle in a browser.
- Login uses the mobile token routes under `/api/mobile/auth/`; see [mobile-app.md](mobile-app.md#authentication).

```bash
EXPO_PUBLIC_API_BASE_URL=https://staging.example.com npx expo prebuild --platform android
cd android && EXPO_PUBLIC_API_BASE_URL=https://staging.example.com ./gradlew assembleRelease
```

Whether the value reaches the bundle in a release build through this exact command is not run.

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
