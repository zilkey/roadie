/** Dev default: talk to the local emulators unless real credentials are configured. Import this first. */
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8280";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9319";
  process.env.GCLOUD_PROJECT ??= "demo-band-tracker";
}
export {};
