"use client";
import { useEffect, useState } from "react";
import { clientAuth } from "@/lib/firebase-client";
import { parsePaper, type Paper } from "./sheet";

/** The paper size a person last picked for stage plot PDFs, kept on the device per signed-in user. Letter until they pick A4. */
const key = () => `plotPaper:${clientAuth().currentUser?.uid ?? "anon"}`;
export function readPlotPaper(): Paper {
  try { return parsePaper(localStorage.getItem(key())); } catch { return "letter"; }
}
export function writePlotPaper(p: Paper) {
  try { localStorage.setItem(key(), p); } catch { /* private mode: the pick lasts for this page */ }
}
export const PAPER_OPTIONS = [["letter", "Letter"], ["a4", "A4"]] as const;

/** [paper, setPaper]: the remembered size (read after mount, so the first render matches the server). */
export function usePlotPaper(): [Paper, (p: Paper) => void] {
  const [paper, set] = useState<Paper>("letter");
  useEffect(() => { set(readPlotPaper()); }, []);
  return [paper, (p) => { writePlotPaper(p); set(p); }];
}
