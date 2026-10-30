import type { ReactNode } from "react";

export type Feature = "calendar" | "gmail" | "drive";
export interface Status {
  configured: boolean;
  /** Set up, but still on the local fake (its *_BASE_URL is set). */
  fakes?: Feature[];
  me: { googleEmail: string; features: Feature[] } | null;
  band: { email: string; name: string; isMe: boolean; features: Feature[] } | null;
  missing?: Feature[];
  /** Drive can be used for this band: the local fake, or the band's Google account has Drive connected. */
  driveReady: boolean;
  /** The chosen band folder as Drive shows it now; name null (with error) when Drive can't open it. */
  bandFolder: FolderStatus;
  /** The chosen rehearsal recordings folder, the same way. */
  rehearsalFolder: FolderStatus;
  /** The chosen Charts folder (lyrics, chord sheets), the same way. */
  chartsFolder: FolderStatus;
  /** The chosen Demos folder (audio uploaded to songs), the same way. */
  demosFolder: FolderStatus;
  /** The chosen Songwriting folder (audio uploaded to songs in the Writing phase), the same way. */
  songwritingFolder: FolderStatus;
  /** The chosen Shows folder (a show's posters, in a folder per show), the same way. */
  showsFolder: FolderStatus;
  /** The chosen Releases folder (a release's new Drive folder is made inside it), the same way. */
  releasesFolder: FolderStatus;
  /** The caller can use Calendar: the local fake, or their own Google account has Calendar connected. */
  calendarReady: boolean;
  /** The band's shared calendar, as named when it was chosen. */
  calendar: { id: string; name: string } | null;
}
export type FolderStatus = { id: string; name: string | null; url: string | null; error?: string } | null;
export interface Folder { id: string; name: string; url: string; ownerEmail: string }
export interface Calendar { id: string; name: string; accessRole: string; primary?: boolean; canWrite: boolean }
export interface Check { canWrite: boolean; accessRole: string | null; reason: "not_connected" | "no_access" | "read_only" | null }

/** Order and wording from the setup wireframe ("Connect Google for ..."). */
export const FEATURES: [Feature, string, string][] = [
  ["calendar", "Calendar", "shows and rehearsals on the band calendar"],
  ["gmail", "Gmail", "send pitches and “can you play?” emails"],
  ["drive", "Drive", "song files, sharing checks and receipts"],
];
export const list = (fs: Feature[]) => FEATURES.filter(([f]) => fs.includes(f)).map(([, n]) => n).join(", ");


/** Shown instead of the connect options when the server has no Google OAuth client. */
export function NotConfiguredCard(): ReactNode {
  return (
    <section className="card" data-testid="google-not-configured">
      <div className="card-head"><h2>Not set up on this server</h2></div>
      <p className="m-0">Google sign-in for Gmail, Calendar and Drive needs an OAuth client on the server (<code>GOOGLE_OAUTH_CLIENT_ID</code>; see docs/FIREBASE-SETUP.md). Until then, email, calendar events and Drive go to the local fakes.</p>
    </section>
  );
}
