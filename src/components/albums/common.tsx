"use client";
import Link, { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { ALBUM_STATUS_LABEL, TRACK_STATUS_LABEL, sortTracks } from "@/lib/albums";
import type { Album, AlbumStatus, AlbumTrack, FileDoc, Musician, Project, Song, TrackStatus } from "@/schema";

export type AlbumRow = Row<Album>;
export type TrackRow = Row<AlbumTrack>;
export type FileRow = Row<FileDoc>;

/** Every album of the open artist, plus every track across them (for counts and lengths on the index) and the band's songs. */
export function useAlbums() {
  const { artistId } = useArtist();
  const albums = useCollection<Album>("albums", { where: [["artistId", "==", artistId]] });
  const tracks = useCollection<AlbumTrack>("tracks", { group: true });
  const songs = useCollection<Song>("songs");
  return { albums: albums.rows ?? [], tracks: tracks.rows ?? [], songs: songs.rows ?? [], loading: [albums, tracks, songs].some((c) => c.loading) };
}

/**
 * One album with everything its pages read: the album, its tracks in order, its files (album-level and every track's),
 * the band's songs (titles, keys, tempos, the songs' own files on the track page), musicians (for credits) and its project.
 */
export function useAlbum(id: string) {
  const album = useDoc<Album>("albums", id);
  const tracks = useCollection<AlbumTrack>(`albums/${id}/tracks`);
  const files = useCollection<FileDoc>("files", { where: [["albumId", "==", id]] });
  const songs = useCollection<Song>("songs");
  const musicians = useCollection<Musician>("musicians");
  const projects = useCollection<Project>("projects");
  const admin = useProfile().role === "admin";
  return {
    album: album.doc, tracks: sortTracks(tracks.rows ?? []), files: files.rows ?? [], songs: songs.rows ?? [], musicians: musicians.rows ?? [],
    project: (projects.rows ?? []).find((p) => p.id === album.doc?.projectId) ?? null, admin,
    loading: album.loading || [tracks, files, songs, musicians, projects].some((c) => c.loading),
  };
}
export type AlbumData = ReturnType<typeof useAlbum>;

/** A status pill: the album's or a track's. Released and Mastered read as done (green). */
export function StatusPill({ status, kind = "album", testid }: { status: AlbumStatus | TrackStatus; kind?: "album" | "track"; testid?: string }) {
  const label = kind === "album" ? ALBUM_STATUS_LABEL[status as AlbumStatus] : TRACK_STATUS_LABEL[status as TrackStatus];
  const done = status === "released" || status === "mastered" || status === "mixed";
  return <span className={`pill${done ? " ok" : ""}`} data-testid={testid}>{label}</span>;
}

/** The album's own page, and a track's. */
export const albumHref = (id: string, tab?: "money" | "files") => `/albums/${id}${tab ? `?tab=${tab}` : ""}`;
export const trackHref = (albumId: string, trackId: string) => `/albums/${albumId}/tracks/${trackId}`;

export function AlbumMissing() {
  return <div className="empty" data-testid="not-found"><span>That album isn&apos;t here any more.</span> <Link href="/albums" className="font-bold">Back to Albums</Link></div>;
}
