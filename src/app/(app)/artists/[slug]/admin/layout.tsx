"use client";
import { AdminOnly } from "@/components/Guard";
import { SettingsNav } from "@/components/SettingsNav";

/** Every /admin/* page sits in the artist-settings shell: the sub-nav beside the page (above it when the content area is narrow), each page carrying its own title. */
export default function AdminLayout({ children }: LayoutProps<"/artists/[slug]/admin">) {
  return <AdminOnly><Shell>{children}</Shell></AdminOnly>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <SettingsNav />
      <div className="min-w-0" style={{ flex: "999 1 560px" }}>{children}</div>
    </div>
  );
}
