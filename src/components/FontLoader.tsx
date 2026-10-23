"use client";
import { useEffect } from "react";

/** Loads Google Fonts without blocking render (offline-safe). */
export function FontLoader() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
  return null;
}
