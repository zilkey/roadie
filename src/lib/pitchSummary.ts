import { isActive } from "@/lib/booking";

type Stamp = { toMillis(): number };
/** Millis of a Firestore-style timestamp, 0 when missing. */
export const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;

type Ended = { status: string; showIds: string[] };
type Stamped = { lastContactAt?: unknown; createdAt?: unknown };

/** How a finished pitch ended, as the card says it. */
export const pitchOutcome = (p: Ended) =>
  p.status === "booked" || p.showIds.length > 0 ? "Became a show" : p.status === "declined" ? "Declined" : "Dropped";
/** When a past pitch happened: its last contact, else when it was made. */
export const pitchWhen = (p: Stamped) => ms(p.lastContactAt) || ms(p.createdAt);
/** Pitches that ended, newest first. */
export const pastPitches = <P extends Ended & Stamped>(mine: P[]): P[] => mine.filter((p) => !isActive(p.status)).sort((a, b) => pitchWhen(b) - pitchWhen(a));

/** "1 email thread" / "3 email threads"; empty for none. */
export const threadsText = (n: number) => (n > 0 ? `${n} email thread${n === 1 ? "" : "s"}` : "");
/** The empty-state line's pieces: the past-pitch part is kept as is, the threads part is added after " · " (or stands alone). */
export const pitchLineParts = (hasPast: boolean, threadCount: number): { past: boolean; threads: string; sep: boolean } => ({
  past: hasPast, threads: threadsText(threadCount), sep: hasPast && threadCount > 0,
});
