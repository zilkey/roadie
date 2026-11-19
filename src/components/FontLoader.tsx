"use client";
import { useEffect } from "react";

/** Loads Google Fonts without blocking render (offline-safe). DM Mono is the song docs' font, so chords line up as they do in the doc. */
export function FontLoader() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap";
    document.head.appendChild(l);
  }, []);
  return null;
}
