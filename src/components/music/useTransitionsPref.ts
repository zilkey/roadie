"use client";
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { clientDb } from "@/lib/firebase-client";
import { runCommand } from "@/lib/commands";

/**
 * Live "Show transitions" switch of the signed-in user (userPrefs/{uid}.setlistTransitions; owner-only read), off until set.
 * `set` saves it (command setlists.setShowTransitions) and flips at once; a failed save flips it back.
 */
export function useTransitionsPref() {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => setOn(s.data()?.setlistTransitions === true), () => undefined);
  }, [uid]);
  const set = useCallback((v: boolean) => {
    setOn(v);
    runCommand("setlists.setShowTransitions", { on: v }).catch(() => setOn(!v));
  }, []);
  return { on, set };
}
