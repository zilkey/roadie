import { authenticatePerson } from "@/server/session";
import { acceptInvite, declineInvite } from "@/server/commands/invites";
import { AppError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Answer an invite to join another artist (tenancy plan D3): `accept` or `decline`. No artist header: the person may have no
 * membership there (or anywhere) yet, so the caller is a PersonCtx from their verified ID token, and the invite names the artist.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    const ctx = await authenticatePerson(req.headers.get("authorization"));
    if (action === "accept") return Response.json(await acceptInvite(ctx, id));
    if (action === "decline") return Response.json(await declineInvite(ctx, id));
    throw new AppError("not_found", "Say accept or decline", 404);
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
