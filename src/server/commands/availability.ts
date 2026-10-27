import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc } from "../db";
import { AppError } from "../errors";
import { gmailClient, IntegrationError } from "../integrations";
import { setAskChannel } from "../prefs";
import { answerLink, hashToken, newToken } from "../availability";
import { dateStr } from "@/schema";
import { fmtLong, showName, type ShowPlaceLike } from "@/lib/shows";

const answer = z.enum(["yes", "no", "maybe"]);
/** How the band hears about an ask: everyone gets their own link by email, or an admin posts one message to the band's Signal group. */
const channel = z.enum(["email", "signal"]).default("email");
const ROLES = ["admin", "mcp"] as const;

async function requireAv(id: string): Promise<Doc> {
  const av = await db.get("availability", id);
  if (!av || av.deletedAt) throw new AppError("not_found", "Availability question not found", 404);
  return av;
}

export interface AskResult {
  /** The first date's ask: answer links point here, and the answer page finds the other dates from it. */
  id: string;
  /** availability.ask: one ask per date, in date order. */
  ids?: string[];
  /** Answer links by musician id. Shown once: only a hash is stored. Use these for people with no email. */
  links: Record<string, string>;
  emailed: string[];
  /** MCP callers never send: each person's message is left as a Gmail draft for an admin to send. */
  drafted?: string[];
  notEmailed: { musicianId: string; name: string; reason: string }[];
  /** channel "signal": the people the admin's Signal post is for. They answer signed in on the pitch or show page, so no email went out. */
  viaSignal?: string[];
}

/**
 * channel "signal": nothing is sent from here (no one can post to a Signal group but a person). Signed-in people answer on the
 * pitch or show page; anyone with no login (a sub) still needs their own link, returned for the admin to copy.
 */
async function signalResult(id: string, targets: string[], tokens: Record<string, string>): Promise<AskResult> {
  const out: AskResult = { id, links: {}, emailed: [], notEmailed: [], viaSignal: [] };
  for (const musicianId of targets) {
    const m = await db.get("musicians", musicianId);
    const name = (m?.name as string | undefined) ?? "Someone";
    out.viaSignal!.push(name);
    if (tokens[musicianId]) {
      out.links[musicianId] = answerLink(id, musicianId, tokens[musicianId]);
      out.notEmailed.push({ musicianId, name, reason: "No login, so they can't answer on the page. Send them their link." });
    }
  }
  return out;
}

/** Of these musicians, the ones no user account is linked to: they can't sign in to answer. */
async function withoutLogin(ids: string[]): Promise<string[]> {
  const linked = new Set<string>();
  for (let i = 0; i < ids.length; i += 30) {
    for (const u of await db.list("users", (q) => q.where("musicianId", "in", ids.slice(i, i + 30)))) linked.add(u.musicianId as string);
  }
  return ids.filter((m) => !linked.has(m));
}

function signalFromApp(ctx: { via?: string }, ch: "email" | "signal") {
  if (ch === "signal" && ctx.via === "mcp") {
    throw new AppError("invalid_input", "Only a person can post to Signal. Give the admin the message and the band's Signal group link (the artist's signalGroupUrl) to post themselves.", 400);
  }
}

/** Email each musician their personal link. A failure for one person never blocks the rest. */
async function sendLinks(ctx: { uid: string; via?: string }, av: { id: string; label: string }, tokens: Record<string, string>, message: string, reminder: boolean): Promise<AskResult> {
  const user = await db.get("users", ctx.uid);
  if (!user) throw new AppError("forbidden", "No user for this account", 403);
  const out: AskResult = { id: av.id, links: {}, emailed: [], notEmailed: [] };
  for (const [musicianId, token] of Object.entries(tokens)) {
    const m = await db.get("musicians", musicianId);
    const url = answerLink(av.id, musicianId, token);
    out.links[musicianId] = url;
    const name = (m?.name as string | undefined) ?? "Someone";
    if (!m?.email) { out.notEmailed.push({ musicianId, name, reason: "No email on file. Send them their link." }); continue; }
    try {
      const mail = {
        account: user.email, to: [m.email],
        subject: `${reminder ? "Reminder: " : ""}Can you play ${av.label}?`,
        body: `${message}\n\nAnswer here: ${url}\n\nThanks,\n${user.name}`,
      };
      if (ctx.via === "mcp") { await gmailClient().createDraft(mail); (out.drafted ??= []).push(name); } else { await gmailClient().send(mail); out.emailed.push(name); }
    } catch (e) {
      out.notEmailed.push({ musicianId, name, reason: e instanceof IntegrationError ? e.message : "Email failed" });
    }
  }
  return out;
}

export const availabilityAsk = defineCommand({
  name: "availability.ask", roles: [...ROLES],
  description:
    "Ask musicians if they can play one date (date) or several (dates), from a pitch (pitchId) or show (showId). Each one gets one personal answer link (works without login) covering every date: emailed when an admin asks in the app, left as a Gmail draft (not sent) when asked through MCP. " +
    "A date that already has an open ask on this pitch or show adds the people to it, with fresh links. " +
    "Returns links for anyone without an email so you can text it. channel \"signal\" (app only) sends nothing: the admin posts the message to the band's Signal group and people answer signed in.",
  input: z.strictObject({
    pitchId: z.string().min(1).optional(), showId: z.string().min(1).optional(), date: dateStr.optional(), dates: z.array(dateStr).min(1).optional(), label: z.string().min(1).optional(),
    musicianIds: z.array(z.string().min(1)).min(1), message: z.string().min(1).optional(), channel,
  }),
  async run(ctx, i) {
    signalFromApp(ctx, i.channel);
    const days = [...new Set(i.dates ?? (i.date ? [i.date] : []))].sort();
    if (!days.length) throw new AppError("invalid_input", "Pick a date to ask about", 400);
    const [pitch, show] = await Promise.all([i.pitchId ? db.get("pitches", i.pitchId) : null, i.showId ? db.get("shows", i.showId) : null]);
    if (i.pitchId && (!pitch || pitch.deletedAt)) throw new AppError("not_found", "Pitch not found", 404);
    if (i.showId && (!show || show.deletedAt)) throw new AppError("not_found", "Show not found", 404);
    const place = ((show ? showName(show as ShowPlaceLike) : undefined) ?? pitch?.target?.name) as string | undefined;
    const labelFor = (when: string) => i.label ?? `${place ? `${place} · ` : ""}${when}`;
    const ids = [...new Set(i.musicianIds)];
    for (const m of ids) { const d = await db.get("musicians", m); if (!d || d.deletedAt) throw new AppError("not_found", `Musician ${m} not found`, 404); if (d.archivedAt) throw new AppError("invalid_input", `${d.name} is archived`, 400); }
    // One link per person for the whole ask: the same token's hash goes on every date's doc. Signal: only people with no login need one.
    const noLogin = i.channel === "signal" ? new Set(await withoutLogin(ids)) : null;
    const tokens = Object.fromEntries(ids.filter((m) => !noLogin || noLogin.has(m)).map((m) => [m, newToken()]));
    const hashed = Object.fromEntries(Object.entries(tokens).map(([m, t]) => [m, hashToken(t)]));
    const scope = i.pitchId ? (["pitchId", i.pitchId] as const) : i.showId ? (["showId", i.showId] as const) : null;
    const avIds: string[] = [];
    for (const date of days) {
      const open = scope ? (await db.list("availability", (q) => q.where(scope[0], "==", scope[1]).where("date", "==", date))).find((a) => !a.closedAt) : undefined;
      if (open) {
        await run(ctx, async (w) => {
          const cur = (await w.get("availability", open.id))!;
          await w.update("availability", open.id, {
            askedMusicianIds: [...new Set([...(cur.askedMusicianIds as string[]), ...ids])], linkTokens: { ...cur.linkTokens, ...hashed }, sentAt: w.now, channel: i.channel,
          });
        });
        avIds.push(open.id);
      } else {
        const created = await db.create(ctx, "availability", {
          date, label: labelFor(fmtLong(date)), pitchId: i.pitchId, showId: i.showId, askedMusicianIds: ids, responses: {}, linkTokens: hashed, sentAt: new Date(), channel: i.channel,
        });
        avIds.push(created.id);
      }
    }
    if (ctx.via !== "mcp" && ctx.artistId) await setAskChannel(ctx.uid, ctx.artistId, i.channel);
    const when = days.map(fmtLong).join(" or ");
    const out = i.channel === "signal"
      ? await signalResult(avIds[0], ids, tokens)
      : await sendLinks(ctx, { id: avIds[0], label: labelFor(when) }, tokens, i.message ?? `We have an option for a show${place ? ` at ${place}` : ""} on ${when}. Tap here to say if you're available.`, false);
    return { ...out, ids: avIds };
  },
});

export const availabilityRemind = defineCommand({
  name: "availability.remind", roles: [...ROLES],
  description: "Send a fresh link and reminder email to musicians who have not answered (or to musicianIds, who are added to the ask if new). Earlier links stop working. " +
    "channel \"signal\" (app only) sends nothing and keeps the links of people who can sign in: the admin posts the reminder to the band's Signal group.",
  input: z.strictObject({ id: z.string().min(1), musicianIds: z.array(z.string().min(1)).optional(), message: z.string().min(1).optional(), channel }),
  async run(ctx, i) {
    signalFromApp(ctx, i.channel);
    const av = await requireAv(i.id);
    if (av.closedAt) throw new AppError("closed", "This question is closed. Reopen it first.", 409);
    const asked = av.askedMusicianIds as string[];
    const targets = i.musicianIds ?? asked.filter((m) => !av.responses?.[m]);
    if (!targets.length) return { id: i.id, links: {}, emailed: [], notEmailed: [] } satisfies AskResult;
    // Signal: people who sign in answer on the page, so their links stay as they are. Only those with no login get a fresh one.
    const fresh = i.channel === "signal" ? await withoutLogin(targets) : targets;
    const tokens = Object.fromEntries(fresh.map((m) => [m, newToken()]));
    await run(ctx, async (w) => {
      const cur = (await w.get("availability", i.id))!;
      await w.update("availability", i.id, {
        askedMusicianIds: [...new Set([...(cur.askedMusicianIds as string[]), ...targets])],
        linkTokens: { ...cur.linkTokens, ...Object.fromEntries(Object.entries(tokens).map(([m, t]) => [m, hashToken(t)])) },
        channel: i.channel,
      });
    });
    if (ctx.via !== "mcp" && ctx.artistId) await setAskChannel(ctx.uid, ctx.artistId, i.channel);
    if (i.channel === "signal") return signalResult(i.id, targets, tokens);
    const message = i.message ?? `Checking in on ${av.label}. Can you tell us if you're available?`;
    return sendLinks(ctx, { id: i.id, label: av.label }, tokens, message, true);
  },
});

export const availabilityMark = defineCommand({
  name: "availability.mark", roles: ["admin"],
  description: "Set someone's answer for them (given in person or by text), or clear it with answer:null. Shown as set by admin.",
  input: z.strictObject({ id: z.string().min(1), musicianId: z.string().min(1), answer: answer.nullable(), note: z.string().optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const av = await w.get("availability", i.id);
    if (!av || av.deletedAt) throw new AppError("not_found", "Availability question not found", 404);
    const responses = { ...av.responses };
    if (i.answer) responses[i.musicianId] = { answer: i.answer, ...(i.note?.trim() ? { note: i.note.trim() } : {}), by: "admin", at: w.now };
    else delete responses[i.musicianId];
    const asked = av.askedMusicianIds as string[];
    return w.update("availability", i.id, { responses, askedMusicianIds: asked.includes(i.musicianId) ? asked : [...asked, i.musicianId] });
  }),
});

export const availabilityAnswer = defineCommand({
  name: "availability.answer", roles: ["admin", "member"],
  description: "Answer 'Can you play?' for yourself (signed in). Allowed until the question is closed. Subs without a login use their link instead.",
  input: z.strictObject({ id: z.string().min(1), answer, note: z.string().max(500).optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const av = await w.get("availability", i.id);
    if (!av || av.deletedAt) throw new AppError("not_found", "Availability question not found", 404);
    const me = ctx.musicianId;
    if (!me || !(av.askedMusicianIds as string[]).includes(me)) throw new AppError("forbidden", "You weren't asked about this date", 403);
    if (av.closedAt) throw new AppError("closed", "This question is closed.", 409);
    return w.update("availability", i.id, { responses: { ...av.responses, [me]: { answer: i.answer, ...(i.note?.trim() ? { note: i.note.trim() } : {}), by: "self", at: w.now } } });
  }),
});

export const availabilityAnswerPitchDate = defineCommand({
  name: "availability.answerPitchDate", roles: ["admin"],
  description: "Answer 'Can you play?' for yourself (signed in) on one of a pitch's dates, asked or not: any admin can say if they're free once a date is on the pitch. " +
    "Uses the date's open ask on the pitch, or starts one for just you if there is none.",
  input: z.strictObject({ pitchId: z.string().min(1), date: dateStr, answer, note: z.string().max(500).optional() }),
  async run(ctx, i) {
    const me = ctx.musicianId;
    if (!me) throw new AppError("forbidden", "Your login isn't linked to anyone in the band", 403);
    const pitch = await db.get("pitches", i.pitchId);
    if (!pitch || pitch.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
    const asks = await db.list("availability", (q) => q.where("pitchId", "==", i.pitchId).where("date", "==", i.date));
    if (!(pitch.dates as string[]).includes(i.date) && !asks.length) throw new AppError("invalid_input", "That date isn't on this pitch", 400);
    const response = { answer: i.answer, ...(i.note?.trim() ? { note: i.note.trim() } : {}), by: "self" as const };
    const open = asks.filter((a) => !a.closedAt && !a.deletedAt).sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0];
    if (!open && asks.some((a) => !a.deletedAt)) throw new AppError("closed", "This question is closed.", 409);
    if (!open) {
      return db.create(ctx, "availability", {
        date: i.date, label: `${pitch.target?.name ? `${pitch.target.name} · ` : ""}${fmtLong(i.date)}`, pitchId: i.pitchId,
        askedMusicianIds: [me], responses: { [me]: { ...response, at: new Date() } }, linkTokens: {},
      });
    }
    return run(ctx, async (w) => {
      const cur = (await w.get("availability", open.id))!;
      const asked = cur.askedMusicianIds as string[];
      return w.update("availability", open.id, {
        responses: { ...cur.responses, [me]: { ...response, at: w.now } }, askedMusicianIds: asked.includes(me) ? asked : [...asked, me],
      });
    });
  },
});

export const availabilityClose = defineCommand({
  name: "availability.close", roles: [...ROLES], input: idInput, description: "Close the question: answers stop coming in.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    const av = await w.get("availability", id);
    if (!av || av.deletedAt) throw new AppError("not_found", "Availability question not found", 404);
    return w.update("availability", id, { closedAt: av.closedAt ?? w.now });
  }),
});
export const availabilityReopen = defineCommand({
  name: "availability.reopen", roles: [...ROLES], input: idInput, description: "Reopen a closed question.",
  run: (ctx, { id }) => db.update(ctx, "availability", id, { closedAt: null }),
});

export const availabilityCommands = [availabilityAsk, availabilityRemind, availabilityMark, availabilityAnswer, availabilityAnswerPitchDate, availabilityClose, availabilityReopen];
