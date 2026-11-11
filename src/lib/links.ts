/** "instagram.com/x" -> "https://instagram.com/x"; full URLs are kept as typed. */
export const withScheme = (v: string) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);

/** A link's short label: "LinkedIn" for a LinkedIn profile, else the site's host ("reliantalent.com"). */
export function linkLabel(u: string): string {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    return /(^|\.)linkedin\.com$/i.test(host) ? "LinkedIn" : host;
  } catch { return u; }
}

/** A Google search for a person: their name in quotes, then their role (it often names the agency). */
export const personSearchUrl = (name: string, title?: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`"${name.replace(/"/g, "")}"${title ? ` ${title}` : ""}`)}`;
