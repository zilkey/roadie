"use client";
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A textarea that grows with its content (CSS field-sizing where the browser has it, a scrollHeight fallback elsewhere)
 * and never shrinks below `rows`.
 */
export function AutoGrowTextarea({ value, rows = 3, style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={rows} value={value} style={{ fieldSizing: "content", resize: "none", ...style } as React.CSSProperties} {...rest} />;
}
