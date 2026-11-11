"use client";
import { useState, type ReactNode } from "react";
import { playsInline } from "@/lib/music";
import { FileIcon, type FileRow } from "./common";
import { AudioPanel, PlayToggle } from "./AudioPlayer";

/** A recording on a rehearsal: name, Play (audio only; it opens the waveform under the row), Open in Drive, and `remove`. */
export function RecordingRow({ file, remove }: { file: FileRow; remove?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const playable = playsInline(file);
  return (
    <div className="d-row !block" data-testid={`file-${file.id}`}>
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <FileIcon mime={file.mimeType} kind={file.kind} />
          <span className="min-w-0 truncate font-semibold">{file.title}</span>
        </span>
        {playable && <PlayToggle file={file} open={open} onOpen={setOpen} />}
        <a className="shrink-0 text-sm font-semibold" href={file.url} target="_blank" rel="noreferrer" data-testid="file-open">Open in Drive</a>
        {remove}
      </div>
      {open && playable && <div className="mt-2"><AudioPanel file={file} /></div>}
    </div>
  );
}
