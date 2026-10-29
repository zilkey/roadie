import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, driveRef } from "./common";

/** A full-length album, an EP or a single. */
export const releaseKind = z.enum(["album", "ep", "single"]);
export type ReleaseKind = z.infer<typeof releaseKind>;
/** Where the record is in its life, from the first plan to the release. */
export const releaseStatus = z.enum(["planning", "recording", "mixing", "mastering", "released"]);
export type ReleaseStatus = z.infer<typeof releaseStatus>;
/** Where a track is: tracked, overdubbed, being mixed, mixed (a mix was approved) or mastered. */
export const trackStatus = z.enum(["tracking", "overdubs", "mixing", "mixed", "mastered"]);
export type TrackStatus = z.infer<typeof trackStatus>;

/** One line of a track's credits: who did what ("Ingrid", "Lead vocals, acoustic guitar"). Players start from the band's people; guests are typed. */
export const trackCredit = z.strictObject({ who: z.string().min(1), role: z.string().min(1) });
export type TrackCredit = z.infer<typeof trackCredit>;

/**
 * releases/{id}: a record the band is making or has made. Its tracks are releases/{id}/tracks; the files that only belong to
 * the record (mixes, masters, stems, artwork) are `files` docs with releaseId (and releaseTrackId for a track's); its money is
 * the project it points at (projectId, kind "release", made with the release, like a show's), with the release's own budget to
 * measure that spend against. Everyone in the band reads releases; admins write them.
 */
export const Release = entity({
  artistId: id,
  title: z.string().min(1),
  kind: releaseKind,
  status: releaseStatus,
  /** The money bucket (projects/{id}, kind "release"); renamed with the release. */
  projectId: id,
  /** Target (or actual) release date, YYYY-MM-DD. */
  releaseDate: dateStr.optional(),
  /** Planned spend, cents; the Money tab shows spent against it. */
  budget: cents.nonnegative().optional(),
  /** The cover image, a Drive file. */
  cover: driveRef.optional(),
  /** "Band folder / Releases / {title}" in Drive, made on request; uploads land there. */
  driveFolderId: z.string().optional(),
  distributor: z.string().optional(),
  upc: z.string().optional(),
  /** Free text: "Digital, CD, Vinyl". */
  formats: z.string().optional(),
});
export const ReleaseInput = Release.omit(serverMask);
export type Release = z.infer<typeof Release>;

/**
 * releases/{releaseId}/tracks/{id}: one song's place on the record. Title and length start from the song and may differ on
 * the release; `side` is set by side breaks (vinyl) and is blank until there is one. position is 1-based and dense.
 */
export const ReleaseTrack = entity({
  releaseId: id,
  position: z.number().int().positive(),
  /** "A", "B"... once the release has side breaks. */
  side: z.string().optional(),
  songId: id,
  title: z.string().min(1),
  status: trackStatus,
  isrc: z.string().optional(),
  lengthSec: z.number().int().nonnegative().optional(),
  explicit: z.boolean().optional(),
  credits: z.array(trackCredit).default([]),
});
export const ReleaseTrackInput = ReleaseTrack.omit(serverMask);
export type ReleaseTrack = z.infer<typeof ReleaseTrack>;
