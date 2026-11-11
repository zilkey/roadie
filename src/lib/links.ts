/** "instagram.com/x" -> "https://instagram.com/x"; full URLs are kept as typed. */
export const withScheme = (v: string) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
