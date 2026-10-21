# CleanLens native app (Android / iOS) — optional

The web app already installs on phones as a PWA (see the main README). Use this folder only if you need a real store app.
This wrapper (Capacitor) loads your hosted CleanLens site inside a native shell, so you update the app by updating the server.

1. Deploy the backend over HTTPS first. Put its address in `capacitor.config.json` → `server.url`.
2. `cd mobile && npm install`
3. Android: `npx cap add android` → `npx cap sync` → `npx cap open android` → in Android Studio: Build → Build APK(s).
   In `android/app/src/main/AndroidManifest.xml` make sure these exist:
   `<uses-permission android:name="android.permission.CAMERA"/>` and `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>`
4. iOS (needs a Mac and Xcode): `npx cap add ios` → `npx cap open ios`. In `Info.plist` add NSCameraUsageDescription and NSLocationWhenInUseUsageDescription (short sentences explaining why).
5. Replace the app icon and splash with `public/icons/icon-512.png`.

Notes: Google Play needs a developer account (one-time fee). Apple may reject apps that are only a website in a shell, so for iPhones the PWA ("Add to Home Screen") is the safer choice.
