import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, driveRef } from "./common";

/** A full-length album, an EP or a single. */
export const albumKind = z.enum(["album", "ep", "single"]);
export type AlbumKind = z.infer<typeof albumKind>;
/** Where the record is in its life, from the first plan to the release. */
export const albumStatus = z.enum(["planning", "recording", "mixing", "mastering", "released"]);
export type AlbumStatus = z.infer<typeof albumStatus>;
/** Where a track is: tracked, overdubbed, being mixed, mixed (a mix was approved) or mastered. */
export const trackStatus = z.enum(["tracking", "overdubs", "mixing", "mixed", "mastered"]);
export type TrackStatus = z.infer<typeof trackStatus>;

/** One line of a track's credits: who did what ("Ingrid", "Lead vocals, acoustic guitar"). Players start from the band's people; guests are typed. */
export const trackCredit = z.strictObject({ who: z.string().min(1), role: z.string().min(1) });
export type TrackCredit = z.infer<typeof trackCredit>;

/**
 * albums/{id}: a record the band is making or has made. Its tracks are albums/{id}/tracks; the files that only belong to
 * the record (mixes, masters, stems, artwork) are `files` docs with albumId (and albumTrackId for a track's); its money is
 * the project it points at (projectId, kind "album", made with the album, like a show's), with the album's own budget to
 * measure that spend against. Everyone in the band reads albums; admins write them.
 */
export const Album = entity({
  artistId: id,
  title: z.string().min(1),
  kind: albumKind,
  status: albumStatus,
  /** The money bucket (projects/{id}, kind "album"); renamed with the album. */
  projectId: id,
  /** Target (or actual) release date, YYYY-MM-DD. */
  releaseDate: dateStr.optional(),
  /** Planned spend, cents; the Money tab shows spent against it. */
  budget: cents.nonnegative().optional(),
  /** The cover image, a Drive file. */
  cover: driveRef.optional(),
  /** "Band folder / Albums / {title}" in Drive, made on request; uploads land there. */
  driveFolderId: z.string().optional(),
  distributor: z.string().optional(),
  upc: z.string().optional(),
  /** Free text: "Digital, CD, Vinyl". */
  formats: z.string().optional(),
});
export const AlbumInput = Album.omit(serverMask);
export type Album = z.infer<typeof Album>;

/**
 * albums/{albumId}/tracks/{id}: one song's place on the record. Title and length start from the song and may differ on
 * the album; `side` is set by side breaks (vinyl) and is blank until there is one. position is 1-based and dense.
 */
export const AlbumTrack = entity({
  albumId: id,
  position: z.number().int().positive(),
  /** "A", "B"... once the album has side breaks. */
  side: z.string().optional(),
  songId: id,
  title: z.string().min(1),
  status: trackStatus,
  isrc: z.string().optional(),
  lengthSec: z.number().int().nonnegative().optional(),
  explicit: z.boolean().optional(),
  credits: z.array(trackCredit).default([]),
});
export const AlbumTrackInput = AlbumTrack.omit(serverMask);
export type AlbumTrack = z.infer<typeof AlbumTrack>;
