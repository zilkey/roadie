"use client";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { Tabs } from "@/components/booking/common";

type Tab = "users" | "developers";

/** Both tabs arrive already rendered on the server; `developers` is only passed when the app runs on localhost. */
export function McpTabs({ users, developers }: { users: React.ReactNode; developers?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <AdminOnly>
      <div className="grid gap-5">
        <PageTitle title="Connect Roadie to Claude" sub="Ask Claude about your shows, pitches, songs and dates, and let it do the busywork for you." />
        {developers ? (
          <Tabs<Tab> testid="mcp-tab" value={tab} onChange={setTab} options={[["users", "Users"], ["developers", "Developers"]]} />
        ) : null}
        {developers && tab === "developers" ? developers : users}
      </div>
    </AdminOnly>
  );
}
