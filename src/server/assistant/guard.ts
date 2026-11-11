import type { MessageData, Part } from "genkit";

/**
 * Roadie's own checks around the model: a reply that says it changed something when nothing was written, and
 * conversation parts the Vertex Interactions API rejects.
 */

// "let me update that", "I'll set it", "on it": a promise. Only counts when nothing was written this message.
const PROMISE = /\b(let me|i'?ll|i will|i'?m going to|i am going to|on it)\b/i;
const DID = "updated|changed|added|set|moved|logged|saved|booked|fixed|put|marked|removed|archived|created|noted|attached|linked";
// "I've updated", "Updated the load-in", "Added Dean to the show" (a clause starting with the verb). A clause starting
// "Set times…", "Setlist…" or "Set length…" is the noun, not the verb.
const CLAIM = new RegExp(String.raw`\b(?:i'?ve|i have|i)\s+(?:just\s+|now\s+|already\s+)?(?:${DID})\b|(?:^|[.!;:]\s+|,\s*and\s+)(?:(?!set\s+(?:times?|lengths?|list)\b)(?:${DID})|done)\b`, "i");
// "the contact is there", "it's on the page": a statement about a record no tool showed.
const THERE = /\b(?:is|are|it'?s|they'?re)\s+(?:already\s+|now\s+|all\s+)?(?:there|on (?:the|that|this|your) (?:page|show|sheet)|in there|showing|in place)\b/i;

/** True when the text says something changed, will change, or is already on a record. */
export const claimsChange = (text: string) => {
  const t = text.trim();
  return !!t && (PROMISE.test(t) || CLAIM.test(t) || THERE.test(t));
};

const keep = (p: Part) => {
  if (p.toolRequest || p.toolResponse || p.media || p.data !== undefined || p.custom) return true;
  // An empty thought becomes a "thought" step with neither summary nor signature.
  if (p.reasoning !== undefined) return !!p.reasoning.trim() || typeof p.metadata?.thoughtSignature === "string";
  // An empty text part is sent as {type: "text"} with no text: "Missing text in content of type text".
  if (p.text !== undefined) return !!p.text.trim();
  return false;
};

/**
 * The conversation without parts the Interactions API rejects, and without messages left empty. System messages go too:
 * the flow passes the system prompt on every call, and Genkit hands back the previous step's messages with it folded
 * in, so the second step would carry two ("system role is only supported for a single message in the first position":
 * every multi-step reply failed against the real model on 2026-10-29).
 */
export function cleanMessages(messages: MessageData[]): MessageData[] {
  return messages.flatMap((m) => {
    if (m.role === "system") return [];
    const content = m.content.filter(keep);
    return content.length ? [{ ...m, content }] : [];
  });
}

/** The same conversation with thoughts dropped: the retry after a 400. Thought signatures on tool calls stay. */
export const withoutThoughts = (messages: MessageData[]) =>
  cleanMessages(messages.map((m) => ({ ...m, content: m.content.filter((p) => p.reasoning === undefined && !p.custom?.thought) })));

/** What a request looked like, without its words: logged when the model rejects it, so the next 400 can be read. */
export const requestShape = (messages: MessageData[]) =>
  messages.map((m) => `${m.role}[${m.content.map((p) =>
    p.toolRequest ? `call:${p.toolRequest.name}${p.metadata?.thoughtSignature ? "+sig" : ""}`
    : p.toolResponse ? `result:${p.toolResponse.name}`
    : p.reasoning !== undefined ? `thought:${p.reasoning.length}${p.metadata?.thoughtSignature ? "+sig" : ""}`
    : p.text !== undefined ? `text:${p.text.length}`
    : Object.keys(p).join("+")).join(",")}]`).join(" ");
