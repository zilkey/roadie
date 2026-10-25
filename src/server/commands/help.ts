/** help.explain: what a page or an idea in the app is, from hard-coded topics (src/lib/help). Reads nothing from the database. */
import { z } from "zod";
import { defineCommand } from "./types";
import { HELP_TOPICS, HELP_TOPIC_IDS, helpTopic, topicForPage } from "@/lib/help";

export const helpExplain = defineCommand({
  name: "help.explain", roles: ["admin", "member"],
  description:
    "Explain the app: what a page shows, what its words mean, how it works. 'Explain this page' / 'what am I looking at?' = no arguments (the page the person is on). " +
    `For an idea, pass topic (${HELP_TOPIC_IDS.join(", ")}). Returns {topic: {title, text, related}}; with nothing that fits, the list of topics. ` +
    "Answer from text only: trim it to what they asked, keep the on-screen names, and don't add features it doesn't mention.",
  input: z.strictObject({ topic: z.enum(HELP_TOPIC_IDS).optional(), route: z.string().max(200).optional(), tab: z.string().max(40).optional() }),
  async run(_ctx, i) {
    const t = i.topic ? helpTopic(i.topic) : i.route ? topicForPage(i.route, i.tab) : undefined;
    const topics = HELP_TOPICS.map(({ id, title }) => ({ id, title }));
    if (!t) return { topic: null, page: i.route ?? null, message: "No explanation for that page yet. Pick a topic.", topics };
    return { topic: { id: t.id, title: t.title, text: t.text, related: t.related.map((id) => ({ id, title: helpTopic(id)?.title ?? id })) } };
  },
});

export const helpCommands = [helpExplain];
