import type { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public issues?: unknown,
  ) {
    super(message);
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.issues ? { issues: this.issues } : {}) } };
  }
}

export function zodIssues(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message }));
}
export const invalid = (e: ZodError) => new AppError("invalid_input", "Input did not validate", 400, zodIssues(e));
