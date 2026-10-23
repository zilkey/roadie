import { adminAuth } from "../admin";
import { newRunId, type Ctx } from "../ctx";
import { db } from "../db";
import { AppError, invalid } from "../errors";
import { registry } from "./registry";

/** Verify the Bearer ID token and build the request context. The users doc must still be live. */
export async function authenticate(authHeader: string | null): Promise<Ctx> {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const role = decoded.role;
  if (role !== "admin" && role !== "member") throw new AppError("forbidden", "No role on this account", 403);
  const user = await db.get("users", decoded.uid);
  if (!user || user.deletedAt || user.role !== role) throw new AppError("forbidden", "Account is not active", 403);
  return { uid: decoded.uid, role, musicianId: decoded.musicianId as string | undefined, via: "app", runId: newRunId() };
}

export async function dispatch(name: string, authHeader: string | null, body: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const cmd = registry[name];
    const ctx = await authenticate(authHeader);
    if (!cmd) throw new AppError("unknown_command", `No command named ${name}`, 404);
    if (!cmd.roles.includes(ctx.role)) throw new AppError("forbidden", `Role ${ctx.role} may not run ${name}`, 403);
    const parsed = cmd.input.safeParse(body ?? {});
    if (!parsed.success) throw invalid(parsed.error);
    const result = await cmd.run(ctx, parsed.data);
    return { status: 200, json: { result, runId: ctx.runId } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: e.toJSON() };
    console.error(e);
    return { status: 500, json: { error: { code: "internal", message: "Something went wrong" } } };
  }
}
