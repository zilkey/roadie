/** Email commands. `email.signature` is the admin's Gmail signature, for the composer. */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import { gmailClient, IntegrationError } from "../integrations";
import { sanitizeHtml, htmlToText } from "@/lib/email-html";

export const emailSignature = defineCommand({
  name: "email.signature", roles: ["admin"],
  description: "The caller's Gmail signature (sanitized HTML and plain text), or null when Gmail isn't connected or its grant can't read settings.",
  input: z.object({}),
  async run(ctx) {
    const user = await db.get("users", ctx.uid);
    const account = user?.email as string | undefined;
    if (!account) throw new AppError("not_found", "No email address on your account", 404);
    try {
      const html = sanitizeHtml(await gmailClient().getSignature(account));
      return { html, text: htmlToText(html) };
    } catch (e) {
      // Not connected (401) or the grant can't read settings (403): the UI says "Connect Gmail again".
      if (e instanceof IntegrationError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  },
});

export const emailCommands = [emailSignature];
