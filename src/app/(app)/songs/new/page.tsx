"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { BackTo } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { parseLen } from "@/lib/music";

export default function NewSong() { return <AdminOnly><Form /></AdminOnly>; }

function Form() {
  const router = useRouter();
  const { call, error, busy, setError } = useCommand();
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [len, setLen] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lengthSec = parseLen(len);
    if (len.trim() && lengthSec === undefined) { setError("Length looks like 3:52"); return; }
    const r = await call("songs.create", {
      title: title.trim(), status: "active", ...(key.trim() ? { key: key.trim() } : {}), ...(lengthSec !== undefined ? { lengthSec } : {}), files: picks,
    });
    if (r?.id) router.push(`/songs/${r.id}`);
  }

  return (
    <form className="grid gap-3" onSubmit={save} data-testid="add-song">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title="Add a song" sub="Type the title and the app searches Drive for audio, video and docs." />
      <label className="grid gap-1"><span className="lbl">Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required data-testid="song-title" />
      </label>
      <DrivePicker syncWith={title} onChange={setPicks} />
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="lbl">Key</span><input className="input" value={key} onChange={(e) => setKey(e.target.value)} data-testid="song-key" /></label>
        <label className="grid gap-1"><span className="lbl">Length</span><input className="input" placeholder="3:52" value={len} onChange={(e) => setLen(e.target.value)} data-testid="song-length" /></label>
      </div>
      <button className="btn acc" disabled={busy || !title.trim()} data-testid="save-song">Save song{picks.length ? ` with ${picks.length} file${picks.length === 1 ? "" : "s"}` : ""}</button>
      <ErrorBox error={error} />
    </form>
  );
}
