import { AppError } from "@/server/errors";

/** Shared by the public (no-login) route handlers under /api/public. */
export const publicFail = (e: unknown) => {
  if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
  console.error(e);
  return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
};
