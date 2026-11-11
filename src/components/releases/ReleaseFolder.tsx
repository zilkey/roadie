"use client";
import { useEffect, useState } from "react";
import Link from "@/lib/artist";
import { FolderPicker } from "@/components/google/FolderPicker";
import type { Status } from "@/components/google/shared";
import { ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import type { ReleaseRow } from "./common";

/**
 * The Drive folder slot on a release's details. With a folder: its name as a link, and for admins "Change". Without
 * one (admins): "Connect Drive folder", which opens a small panel with two paths. Find an existing folder (search the
 * band's Drive by name or paste a folder link; picking one connects it with releases.connectFolder), or Create a new
 * one (a name, prefilled with the release title, made inside the Releases folder chosen on Settings > Google with
 * releases.folder; off, with a note linking to Settings, until that folder is chosen).
 */
export function ReleaseFolder({ release, admin }: { release: ReleaseRow; admin: boolean }) {
  const { call, error, busy, setError } = useCommand();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(release.title);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!open || status) return;
    runCommand<Status>("google.status", {}).then(setStatus, () => undefined);
  }, [open, status]);

  const close = () => { setOpen(false); setError(null); };
  const hasReleases = !!status?.releasesFolder;
  const connect = async (folder: string) => { if (await call("releases.connectFolder", { id: release.id, folder })) close(); };
  const create = async () => { if (await call("releases.folder", { id: release.id, name: name.trim() })) close(); };

  const link = release.driveFolderId && (
    <a href={`https://drive.google.com/drive/folders/${release.driveFolderId}`} target="_blank" rel="noreferrer" data-testid="release-folder-link">{release.driveFolderName ?? release.title} ↗</a>
  );
  if (!admin) return link || <span className="d-muted">None yet</span>;

  return (
    <div className="grid gap-2 justify-items-start">
      {!open && (
        <div className="flex flex-wrap items-center gap-2">
          {link}
          <button type="button" className={link ? "btn text sm" : "btn outline sm"} onClick={() => { setName(release.title); setOpen(true); }} data-testid={link ? "release-folder-change" : "connect-folder-btn"}>
            {link ? "Change" : "Connect Drive folder"}
          </button>
        </div>
      )}
      {open && (
        <div className="card grid w-full gap-3" data-testid="connect-folder-panel">
          <div className="grid gap-1">
            <span className="lbl">Find an existing folder</span>
            <FolderPicker value={null} onChange={(f) => { if (f) void connect(f.id); }} disabled={busy} testid="release-drive" />
          </div>
          <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim() && hasReleases) void create(); }}>
            <label htmlFor="new-folder-name" className="lbl">Or create a new one</label>
            <div className="flex gap-2">
              <input id="new-folder-name" className="input" value={name} disabled={!hasReleases} onChange={(e) => setName(e.target.value)} data-testid="new-folder-name" />
              <button className="btn acc" disabled={busy || !hasReleases || !name.trim()} data-testid="new-folder-create">Create</button>
            </div>
            {status && !hasReleases && (
              <span className="s" data-testid="new-folder-needs-releases">Choose a Releases folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to create one here.</span>
            )}
          </form>
          <ErrorBox error={error} />
          <div><button type="button" className="btn text" onClick={close} data-testid="connect-folder-cancel">Cancel</button></div>
        </div>
      )}
    </div>
  );
}
