"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { artistHeaders } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";
import type { ReadImageResponse } from "@/schema/assistant";

/** Sent as they are: types the model reads, under this size. Anything else (a big phone photo) is shrunk to a JPEG first. */
const AS_IS = /^image\/(png|jpeg|webp|gif)$/;
const AS_IS_BYTES = 3_000_000;
/** The long side of a shrunk photo: plenty for print on a flyer or a screenshot. */
const LONG_SIDE = 2400;

/** A photo small enough to upload quickly. A type the browser can't draw (HEIC in Chrome) goes as it is; the server reads it. */
async function shrink(file: Blob): Promise<Blob> {
  if (AS_IS.test(file.type) && file.size <= AS_IS_BYTES) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, LONG_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return out ?? file;
  } catch {
    return file;
  }
}

/** The first image among pasted or dropped files, if any. */
export function firstImage(files: FileList | File[] | null | undefined): File | undefined {
  return Array.from(files ?? []).find((f) => f.type.startsWith("image/"));
}

/** Read the words in an image with Roadie (POST /api/assistant/read-image). The text is handed back for the message box; nothing is kept. */
export function useImageText() {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);

  const read = useCallback(async (file: Blob): Promise<string | null> => {
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setError(null);
    setReading(true);
    try {
      const image = await shrink(file);
      const form = new FormData();
      form.append("image", image, image.type === "image/jpeg" ? "image.jpg" : "image");
      const token = await clientAuth().currentUser?.getIdToken();
      const res = await fetch("/api/assistant/read-image", { method: "POST", headers: { authorization: `Bearer ${token}`, ...artistHeaders() }, body: form, signal: ctl.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error?.message ?? "I couldn't read that image");
      const text = (json as ReadImageResponse).text.trim();
      if (!text) { setError("I couldn't find any words in that image."); return null; }
      return text;
    } catch (e) {
      if (ctl.signal.aborted) return null;
      setError(e instanceof Error && e.message ? e.message : "I couldn't read that image");
      return null;
    } finally {
      if (run.current === ctl) { run.current = null; setReading(false); }
    }
  }, []);

  return { reading, error, read };
}
