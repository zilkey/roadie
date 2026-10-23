import { adminAuth } from "./admin";
import { db } from "./db";
import { AppError } from "./errors";

/** After sign-in: find the invite by email and set custom claims. */
export async function startSession(authHeader: string | null) {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const email = decoded.email?.toLowerCase();
  if (!email || decoded.email_verified === false) throw new AppError("unauthenticated", "A verified email is required", 401);
  const [user] = await db.list("users", (q) => q.where("email", "==", email).limit(5));
  if (!user) throw new AppError("not_invited", "This email hasn't been invited", 403);
  const claims = { role: user.role as string, ...(user.musicianId ? { musicianId: user.musicianId as string } : {}) };
  await adminAuth().setCustomUserClaims(decoded.uid, claims);
  return { uid: decoded.uid, userId: user.id, name: user.name as string, email, ...claims, mcpAccess: !!user.mcpAccess };
}
