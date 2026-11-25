"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { clientDb } from "@/lib/firebase-client";
import { runCommand } from "@/lib/commands";

export type Theme = "auto" | "light" | "dark";
const KEY = "roadie-theme";
const isTheme = (v: unknown): v is Theme => v === "auto" || v === "light" || v === "dark";

/** Pins the page's colours: data-theme on <html> ("light" or "dark"); auto removes it so globals.css follows the device. */
function apply(t: Theme) {
  const el = document.documentElement;
  if (t === "auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

/**
 * Runs before the app paints: the theme last seen on this device (a copy of the profile's), so a pinned Dark doesn't
 * flash light while Firebase signs in. The profile (userPrefs/{uid}.theme) stays the source of truth: ThemeProvider
 * corrects it once that loads.
 */
export function ThemeScript() {
  const js = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

const Ctx = createContext<{ theme: Theme; set(t: Theme): void }>({ theme: "auto", set: () => undefined });

/** The signed-in person's theme, live from their profile (so it follows them across devices); `set` flips it at once and saves it (theme.set). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [theme, setThemeState] = useState<Theme>(() => {
    try { const t = typeof window === "undefined" ? null : localStorage.getItem(KEY); return isTheme(t) ? t : "auto"; } catch { return "auto"; }
  });
  const show = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
    try { localStorage.setItem(KEY, t); } catch { /* private window: the profile still has it */ }
  }, []);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => { const t = s.data()?.theme; show(isTheme(t) ? t : "auto"); }, () => undefined);
  }, [uid, show]);
  const set = useCallback((t: Theme) => {
    const was = theme;
    show(t);
    runCommand("theme.set", { theme: t }).catch(() => show(was));
  }, [theme, show]);
  return <Ctx.Provider value={{ theme, set }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

const CHOICES: [Theme, string][] = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];

/** The avatar menu's Theme row: Auto / Light / Dark, the current one pressed. Clicking keeps the menu open so the change can be seen. */
export function ThemeChoice({ testid = "theme" }: { testid?: string }) {
  const { theme, set } = useTheme();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" role="group" aria-label="Theme" data-testid={testid} onClick={(e) => e.stopPropagation()}>
      <span className="flex-1 text-sm font-semibold">Theme</span>
      <span className="seg">
        {CHOICES.map(([t, label]) => (
          <button key={t} type="button" role="menuitemradio" aria-checked={theme === t} className={theme === t ? "on" : undefined}
            onClick={() => set(t)} data-testid={`${testid}-${t}`}>{label}</button>
        ))}
      </span>
    </div>
  );
}
