"use client";
import Link, { useArtist } from "@/lib/artist";
import { useFansOn, useShowFans } from "@/lib/fans-client";

/** On a show's page, in the after-show area: new fans from this show who are not in Bandzoogle yet. Members see the count; admins get the link. */
export function ShowFansBanner({ showId }: { showId: string }) {
  const on = useFansOn();
  const admin = useArtist().role === "admin";
  const fans = useShowFans(showId);
  if (!on || !fans || fans.notInBandzoogle <= 0) return null;
  return (
    <div className="card hi" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px" }} data-testid="show-fans-banner" role="status">
      <span><b data-testid="show-fans-count">{fans.notInBandzoogle}</b> new {fans.notInBandzoogle === 1 ? "fan" : "fans"} from {fans.label}</span>
      {admin && <Link href="/fans?bandzoogle=1" className="font-bold underline" data-testid="show-fans-send">Send to Bandzoogle</Link>}
    </div>
  );
}
