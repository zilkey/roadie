"use client";
import { useState } from "react";
import { CommandError, runCommand, type CommandMeta } from "@/lib/commands";

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4 grid gap-0.5">
      <h1 className="text-2xl" data-testid="page-title">{title}</h1>
      {sub && <p className="s">{sub}</p>}
    </div>
  );
}

export function Stub({ title, slice, children }: { title: string; slice: number; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <PageTitle title={title} />
      <div className="card" data-testid="stub"><span className="s">Coming in slice {slice}.</span>{children}</div>
    </div>
  );
}

export function useCommand() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function call<T = { id?: string }>(name: string, input: unknown, meta?: CommandMeta): Promise<T | undefined> {
    setBusy(true); setError(null);
    try {
      return await runCommand<T>(name, input, meta);
    } catch (e) {
      const ce = e as CommandError;
      setError(ce.issues?.length ? `${ce.message}: ${ce.issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : ce.message);
    } finally { setBusy(false); }
  }
  return { call, error, busy, setError };
}
export const ErrorBox = ({ error }: { error: string | null }) => (error ? <div className="err" role="alert" data-testid="error">{error}</div> : null);
