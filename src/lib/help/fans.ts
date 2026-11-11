import type { HelpTopic } from "./types";

/** Help text for the fan email list. Page-specific wording is added with the pages; this is what the list and the commands do. */
export const FAN_TOPICS: HelpTopic[] = [
  {
    id: "fans",
    title: "Fans and the email list",
    text: [
      "Fans are the people who signed up for the band's email list. They sign up on the band's public list page (no login, no app), where they give an email, optionally a first name, and the show they're at or a city. The page picks the show on its own while it's on, and the morning after; they can change it.",
      "Only confirmed and played shows count, never holds, canceled or dropped ones. Each show is read in its venue's time zone (the band's own when the venue has none). A fan who signs up again is merged into the same record, with the new city and show added.",
      "Admins can see the fans, add one from a paper sheet, correct one, or delete one for good. Everyone else in the band sees counts only (how many in total, by city, by show, near a place), never an address.",
      "\"Send to Bandzoogle\" lists the fans not yet added, grouped by their latest city as \"City, ST\" (\"No city\" if they gave none). Copy a group's addresses, paste them into Bandzoogle, then mark the group as added. A fan marked as added is never offered again.",
      "\"Fans near\" a place counts fans who signed up from a city within 60 miles by default, in a straight line. Cities are placed on the map when the fan signs up.",
    ].join("\n\n"),
    related: ["showPage"],
  },
];
