import { z } from "zod";
import { adminAuth } from "./admin";
import { newRunId, type Ctx } from "./ctx";
import { run } from "./db";
import { AppError, invalid } from "./errors";
import { createArtistFor, memberships } from "./commands/people";
import { artistsFor, syncClaims } from "./session";
import { InstrumentList, artistSlug } from "@/schema";

/** `artists.signUp`: what a brand-new person sends to start their first band. */
export const SignUpInput = z.strictObject({
  name: z.string().trim().min(1, "Give your band a name").max(100, "Use at most 100 characters"),
  /** The URL name; made from `name` (and made unique) when absent. */
  slug: artistSlug.optional(),
  /** What the creator plays. Non-empty makes them a Band Member too. */
  instruments: z.array(z.string()).optional(),
});

/**
 * The one write callable without a membership, so it is not in the command registry (Roadie and MCP never see it) and
 * `authenticate` is not used: all it needs is a verified Google ID token. The caller becomes the admin of a new artist.
 * Refuses anyone who already has a membership (they use artists.create from inside the app). Every write goes through
 * run(), so History records it like any command.
 */
export async function signUp(authHeader: string | null, body: unknown): Promise<{ slug: string; id: string; runId: string }> {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const email = decoded.email?.trim().toLowerCase();
  if (!email || decoded.email_verified === false) throw new AppError("unauthenticated", "A verified email is required", 401);
  const uid = decoded.uid;
  const parsed = SignUpInput.safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const input = parsed.data;
  const instruments = input.instruments?.length ? InstrumentList.safeParse(input.instruments) : null;
  if (instruments && !instruments.success) throw invalid(instruments.error);
  const displayName = (typeof decoded.name === "string" && decoded.name.trim()) || email.split("@")[0];
  const ctx: Ctx = { uid, role: "admin", via: "app", runId: newRunId() };

  try {
    const out = await run(ctx, async (w) => {
      const existing = await w.get("users", uid);
      if (existing?.deletedAt) throw new AppError("forbidden", "Account is not active", 403);
      // Memberships in an artist that has since been deleted don't count: that person has no band to open.
      if (existing && ((await artistsFor(existing)).length || memberships(existing).some((x) => x.role !== "admin" && x.role !== "member"))) throw new AppError("already_member", "You already belong to a band", 409);
      const others = (await w.query("users", (q) => q.where("email", "==", email))).filter((u) => u.id !== uid);
      if (others.length) throw new AppError("duplicate", "That email is already a user", 409);
      const musicianId = instruments?.success
        ? (await w.create("musicians", { name: existing?.name ?? displayName, email, instruments: instruments.data, active: true, userId: uid })).id
        : undefined;
      if (existing) await w.update("users", uid, { ...(musicianId ? { musicianId } : {}) });
      else await w.create("users", { email, name: displayName, artists: [], ...(musicianId ? { musicianId } : {}) }, { id: uid });
      // The artist, its starting templates and this person's admin membership: the same steps as artists.create.
      return createArtistFor(w, uid, { name: input.name, slug: input.slug, configurations: [], links: {}, driveFolderId: "" });
    });
    await syncClaims(uid);
    console.info(JSON.stringify({ event: "artists.signUp", ok: true, uid, artistId: out.id, slug: out.slug, runId: ctx.runId }));
    return { slug: out.slug, id: out.id, runId: ctx.runId };
  } catch (e) {
    console.warn(JSON.stringify({ event: "artists.signUp", ok: false, uid, error: e instanceof AppError ? e.code : "internal" }));
    throw e;
  }
}
