"use client";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { MetaCard } from "@/components/posts/MetaCard";

type Tab = "users" | "developers";

/**
 * Settings › Integrations: the band's Instagram & Facebook (for Posts), then connecting Roadie to Claude. Both Claude tabs
 * arrive already rendered on the server; `developers` is only passed when the app runs on localhost.
 */
export function McpTabs({ users, developers }: { users: React.ReactNode; developers?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <AdminOnly>
      <div className="grid gap-5">
        <PageTitle title="Integrations" sub="Post to the band's Instagram, and connect Roadie to Claude." />
        <MetaCard />
        <div className="grid gap-1">
          <h2 className="font-display text-xl font-bold" data-testid="mcp-title">Connect Roadie to Claude</h2>
          <p className="s m-0">Ask Claude about your shows, pitches, songs and dates, and let it do the busywork for you.</p>
        </div>
        {developers ? (
          <Tabs<Tab> testid="mcp-tab" value={tab} onChange={setTab} options={[["users", "Users"], ["developers", "Developers"]]} />
        ) : null}
        {developers && tab === "developers" ? developers : users}
      </div>
    </AdminOnly>
  );
}
