"use client";
import { useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import Link from "@/lib/artist";
import { LineChart } from "@/components/money/charts";
import { useCollection } from "@/lib/firestore-hooks";
import { statsCurrent } from "@/lib/stats";
import type { StatSnapshot } from "@/schema";

export default function Page() { return <AdminOnly><Stats /></AdminOnly>; }

function Stats() {
  const snaps = useCollection<StatSnapshot>("statSnapshots");
  const rows = snaps.rows ?? [];
  const pull = useCommand();
  const imp = useCommand();
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cur = statsCurrent(rows);
  const series = (src: string, f: "followers" | "popularity" | "monthlyListeners" | "streams") =>
    rows.filter((r) => r.source === src && typeof r[f] === "number").map((r) => ({ x: r.date, y: r[f] as number }));

  async function doPull() {
    setMsg(null);
    const r = await pull.call<{ date: string; written: string[] }>("stats.pull", {});
    if (r) setMsg(r.written.length ? `Saved Spotify numbers for ${r.date}.` : `Already have ${r.date}.`);
  }
  async function doImport() {
    setMsg(null);
    const r = await imp.call<{ rows: number; written: string[]; skipped: string[] }>("stats.importCsv", { csv });
    if (r) { setMsg(`Read ${r.rows} rows: ${r.written.length} new, ${r.skipped.length} already there.`); setCsv(""); }
  }
  async function pickFile(f?: File) { if (f) setCsv(await f.text()); }

  return (
    <div className="grid gap-5" data-testid="stats-page">
      <PageTitle back={<Link href="/money" className="back-link" data-testid="back">← Money</Link>} title="Spotify stats" sub="Followers and popularity are pulled daily; monthly listeners and streams come from a Spotify for Artists export." />
      <div className="grid grid-cols-3 gap-5" data-testid="stats-current">
        {([["Followers", cur.followers], ["Monthly listeners", cur.monthlyListeners], ["Popularity", cur.popularity]] as const).map(([l, v]) => (
          <div key={l} className="card"><span className="s">{l}</span><b className="font-mono text-lg" data-testid={`current-${l.split(" ")[0].toLowerCase()}`}>{v ? v.value.toLocaleString("en-US") : "—"}</b>{v && <span className="s">{v.date}</span>}</div>
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <LineChart title="Followers" testid="chart-followers" points={series("spotifyApi", "followers")} />
        <LineChart title="Popularity" testid="chart-popularity" points={series("spotifyApi", "popularity")} />
        <LineChart title="Monthly listeners" testid="chart-listeners" points={series("spotifyForArtists", "monthlyListeners")} />
        <LineChart title="Streams" testid="chart-streams" points={series("spotifyForArtists", "streams")} />
      </div>
      {msg && <span className="chip g self-start" data-testid="stats-msg">{msg}</span>}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="card content-start">
          <span className="lbl">Pull from Spotify</span>
          <span className="s">Runs daily on its own once scheduled; this does it now.</span>
          <ErrorBox error={pull.error} />
          <button className="btn acc" disabled={pull.busy} onClick={doPull} data-testid="stats-pull">Pull now</button>
        </div>
        <div className="card content-start">
          <span className="lbl">Spotify for Artists export</span>
          <span className="s">Upload the audience CSV or paste it. Columns: date (or month), listeners, streams, followers.</span>
          <input ref={file} type="file" accept=".csv,text/csv" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="csv-file" />
          <textarea className="input font-mono text-xs" rows={5} placeholder={"date,listeners,streams\n2026-09,2460,11220"} value={csv} onChange={(e) => setCsv(e.target.value)} data-testid="csv-text" />
          <ErrorBox error={imp.error} />
          <button className="btn acc" disabled={imp.busy || !csv.trim()} onClick={doImport} data-testid="csv-import">Import</button>
        </div>
      </div>
    </div>
  );
}
