/**
 * The data the blocks show (Decision 4): upcoming public shows by the Bandsintown rule, and the artist's links. A few reads.
 */
import { db } from "../db";
import type { Ctx } from "../ctx";
import { zoneOf } from "../zone";
import { dateInZone } from "@/lib/timezone";
import { bandsintownEligible } from "@/lib/bandsintown";
import { publicShowName } from "@/lib/shows";
import { ARTIST_LINKS } from "@/schema/artists";
import type { BlockData, PublicShow } from "./render";

export async function blockData(ctx: Ctx): Promise<BlockData & { today: string }> {
  const today = dateInZone(await zoneOf(ctx));
  const artist = await db.get(ctx, "artists", ctx.artistId);
  const shows = await db.list(ctx, "shows", (q) => q.where("date", ">=", today));
  const pub: PublicShow[] = shows
    .filter((s) => bandsintownEligible(s as never, today))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.times?.showStart ?? "").localeCompare(String(b.times?.showStart ?? "")))
    .map((s) => {
      const city = s.venue?.city ?? s.place?.city;
      const state = s.venue?.state ?? s.place?.state;
      const time = s.times?.showStart ?? s.times?.set;
      return {
        date: s.date as string, name: publicShowName(s as never),
        ...(city ? { place: state ? `${city}, ${state}` : String(city) } : {}),
        ...(typeof s.ticketUrl === "string" && /^https?:\/\//.test(s.ticketUrl) ? { ticketUrl: s.ticketUrl } : {}),
        ...(typeof time === "string" ? { time } : {}),
      };
    });
  const links = artist?.links ?? {};
  const out = ARTIST_LINKS.filter(([k]) => k !== "website" && typeof links[k] === "string" && /^https?:\/\//.test(links[k]))
    .map(([key, label]) => ({ key, label, url: links[key] as string }));
  return { artistName: (artist?.publicName as string) || (artist?.name as string) || "", shows: pub, links: out, today };
}
