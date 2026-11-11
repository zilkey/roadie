"use client";
import { clientAuth } from "@/lib/firebase-client";
import { artistHeaders } from "@/lib/commands";
import type { Paper } from "./sheet";
import { readPlotPaper } from "./paperPref";

/** The signed-in member's PDF of a plot, Letter or A4 (default: the size they last picked) (GET /api/stage-plots/{id}/pdf needs the ID token, so a bare link will not do). */
export async function fetchPlotPdf(plotId: string, paper: Paper = readPlotPaper()): Promise<{ blob: Blob; filename: string }> {
  const user = clientAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  const res = await fetch(`/api/stage-plots/${encodeURIComponent(plotId)}/pdf?paper=${paper}`, { headers: { authorization: `Bearer ${await user.getIdToken()}`, ...artistHeaders() } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? "Could not make the PDF");
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "stage-plot.pdf";
  return { blob: await res.blob(), filename };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadPlotPdf(plotId: string, paper: Paper = readPlotPaper()) {
  const { blob, filename } = await fetchPlotPdf(plotId, paper);
  saveBlob(blob, filename);
}

/** The phone's share sheet with the PDF attached; where files cannot be shared (most desktops) it downloads the PDF instead. */
export async function sharePlotPdf(plotId: string, paper: Paper = readPlotPaper()): Promise<"shared" | "downloaded"> {
  const { blob, filename } = await fetchPlotPdf(plotId, paper);
  const file = new File([blob], filename, { type: "application/pdf" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "shared"; }
  }
  saveBlob(blob, filename);
  return "downloaded";
}
