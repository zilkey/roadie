"use client";
import Link, { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { TRACK_STATUS_LABEL, sortTracks } from "@/lib/releases";
import type { Release, ReleaseTrack, FileDoc, Musician, Project, Song, TrackStatus } from "@/schema";

export type ReleaseRow = Row<Release>;
export type TrackRow = Row<ReleaseTrack>;
export type FileRow = Row<FileDoc>;

/** Every release of the open artist, plus every track across them (for counts and lengths on the index) and the band's songs. */
export function useReleases() {
  const { artistId } = useArtist();
  const releases = useCollection<Release>("releases", { where: [["artistId", "==", artistId]] });
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true });
  const songs = useCollection<Song>("songs");
  return { releases: releases.rows ?? [], tracks: tracks.rows ?? [], songs: songs.rows ?? [], loading: [releases, tracks, songs].some((c) => c.loading) };
}

/**
 * One release with everything its pages read: the release, its tracks in order, its files (release-level and every track's),
 * the band's songs (titles, keys, tempos, the songs' own files on the track page), musicians (for credits) and its project.
 */
export function useRelease(id: string) {
  const release = useDoc<Release>("releases", id);
  const tracks = useCollection<ReleaseTrack>(`releases/${id}/tracks`);
  const files = useCollection<FileDoc>("files", { where: [["releaseId", "==", id]] });
  const songs = useCollection<Song>("songs");
  const musicians = useCollection<Musician>("musicians");
  const projects = useCollection<Project>("projects");
  const admin = useProfile().role === "admin";
  return {
    release: release.doc, tracks: sortTracks(tracks.rows ?? []), files: files.rows ?? [], songs: songs.rows ?? [], musicians: musicians.rows ?? [],
    project: (projects.rows ?? []).find((p) => p.id === release.doc?.projectId) ?? null, admin,
    loading: release.loading || [tracks, files, songs, musicians, projects].some((c) => c.loading),
  };
}
export type ReleaseData = ReturnType<typeof useRelease>;

/** A track's status pill. Mixed and Mastered read as done (green). */
export function StatusPill({ status, testid }: { status: TrackStatus; testid?: string }) {
  const label = TRACK_STATUS_LABEL[status];
  const done = status === "mastered" || status === "mixed";
  return <span className={`pill${done ? " ok" : ""}`} data-testid={testid}>{label}</span>;
}

/** The release's own page, and a track's. */
export const releaseHref = (id: string, tab?: "money" | "files") => `/releases/${id}${tab ? `?tab=${tab}` : ""}`;
export const trackHref = (releaseId: string, trackId: string) => `/releases/${releaseId}/tracks/${trackId}`;

export function ReleaseMissing() {
  return <div className="empty" data-testid="not-found"><span>That release isn&apos;t here any more.</span> <Link href="/releases" className="font-bold">Back to Releases</Link></div>;
}
