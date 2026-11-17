/**
 * Sign-up is closed unless the server-only doc `platform/config` says `signUpOpen: true` (scripts/platform-config.ts sets
 * it, so opening or closing needs no deploy). No doc means closed. Read straight from Firestore: `platform` is not a
 * collection the app models (backup keeps it as server-kept). Its own file so usage.ts and signUp.ts can both use it.
 */
import { firestore } from "./admin";

export const PLATFORM_CONFIG_DOC = "platform/config";
export async function signUpOpen(): Promise<boolean> {
  const snap = await firestore().doc(PLATFORM_CONFIG_DOC).get();
  return snap.get("signUpOpen") === true;
}
export const INVITE_ONLY = "Roadie is invite-only for now. Ask your band's admin to add you.";
