import { NextResponse, type NextRequest } from "next/server";

/**
 * Old band URLs (/shows/123, /booking/venues/9, /admin/people...) are from before every band page lived under its
 * artist. Sign-in happens in the browser, so the server can't know whose artist to use: send them to /artists with the
 * old path as `next`; that page opens it inside the person's artist (or lets them pick one).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const to = request.nextUrl.clone();
  to.pathname = "/artists";
  to.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to, 307);
}

// Keep in sync with LEGACY_SECTIONS in src/lib/routes.ts (matchers must be literal).
export const config = {
  matcher: ["/shows/:path*", "/booking/:path*", "/songs/:path*", "/money/:path*", "/admin/:path*"],
};
