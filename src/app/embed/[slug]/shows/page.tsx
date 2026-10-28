import type { Metadata } from "next";
import { publicShows, type PublicShows } from "@/server/publicShows";
import { fmtLong, fmtTime } from "@/lib/shows";

// Public, no login: the Upcoming shows list for an iframe on the band's own site. Options in the query:
// theme=light|dark (default: follows the visitor), accent=<hex without #>, config=<lineup id>.
export const metadata: Metadata = { title: "Upcoming shows", robots: { index: false } };
export const dynamic = "force-dynamic";

const hex = (v?: string) => (v && /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(v) ? `#${v}` : undefined);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmbedShows({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const q = await searchParams;
  let data: PublicShows | null = null;
  try { data = await publicShows(slug, { config: one(q.config) || undefined }); } catch { data = null; }
  const theme = one(q.theme) === "dark" ? "dark" : one(q.theme) === "light" ? "light" : "auto";
  const accent = hex(one(q.accent)) ?? "#3a46c4";
  const css = `
    .es{--bg:#fff;--ink:#1b1b1f;--mute:#62646c;--line:#e3e4e8;margin:0;padding:8px;background:transparent;color:var(--ink);font:16px/1.4 system-ui,sans-serif}
    ${theme === "dark" ? ".es{--ink:#f2f2f4;--mute:#a4a6ae;--line:#33343a}" : theme === "auto" ? "@media (prefers-color-scheme:dark){.es{--ink:#f2f2f4;--mute:#a4a6ae;--line:#33343a}}" : ""}
    .es ul{list-style:none;margin:0;padding:0}.es li{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
    .es .d{font-weight:700;min-width:96px}.es .w{flex:1;min-width:0}.es .v{font-weight:600}.es .m{color:var(--mute);font-size:14px}
    .es a{color:${accent};font-weight:600;text-decoration:none}.es a.t{border:1px solid ${accent};border-radius:999px;padding:6px 14px;white-space:nowrap}
    @media (max-width:480px){.es li{flex-wrap:wrap}.es .d{min-width:0;width:100%}}`;
  return (
    <div className="es" data-testid="embed-shows">
      <style>{css}</style>
      {!data ? <p className="m">Shows aren&apos;t available right now.</p> : data.shows.length === 0 ? (
        <p>No shows booked right now.{data.joinUrl && <> <a href={data.joinUrl} target="_top">Join the mailing list</a> to hear first.</>}</p>
      ) : (
        <ul>
          {data.shows.map((s) => (
            <li key={s.id} data-testid="embed-show">
              <span className="d">{fmtLong(s.date)}</span>
              <span className="w">
                <span className="v">{s.venue}</span>{s.city && <span className="m"> · {s.city}</span>}
                <br /><span className="m">{[s.time && fmtTime(s.time), s.billedAs].filter(Boolean).join(" · ")}</span>
              </span>
              {s.ticketUrl && <a className="t" href={s.ticketUrl} target="_blank" rel="noreferrer">Tickets</a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
