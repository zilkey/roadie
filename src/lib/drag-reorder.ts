"use client";
import { useState } from "react";
import type React from "react";

/**
 * Drag-to-reorder for a list: spread `row(i)` on each row and `handle(i)` on what you grab (the same element when the
 * whole row drags). The dragged row dims and the row under the cursor shows an accent line where the drop lands
 * (styled in globals.css by [data-drag]). The preview is the whole row, not just the grip. Lists can nest: a row only
 * reacts to drags that started in its own list, so an item drag never moves its parent and vice versa.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const end = () => { setFrom(null); setOver(null); };

  const handle = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
      const row = e.currentTarget.closest<HTMLElement>("[data-drag-row]");
      if (row && row !== e.currentTarget) {
        const r = row.getBoundingClientRect();
        e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
      }
      setFrom(i);
    },
    onDragEnd: end,
  });

  const row = (i: number) => ({
    "data-drag-row": "",
    "data-drag": from === i ? "from" : from != null && over === i ? (from < i ? "below" : "above") : undefined,
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (from == null) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (over !== i) setOver(i);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (from == null) return;
      e.preventDefault();
      e.stopPropagation();
      if (from !== i) onMove(from, i);
      end();
    },
  });

  return { handle, row, dragging: from != null };
}
