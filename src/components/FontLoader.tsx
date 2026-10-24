"use client";
import { useEffect } from "react";

/** Loads Google Fonts without blocking render (offline-safe). */
export function FontLoader() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);
  return null;
}
