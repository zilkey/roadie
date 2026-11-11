import type { HelpTopic } from "./types";

export const STAGE_PLOT_TOPICS: HelpTopic[] = [
  {
    id: "stagePlots",
    title: "Stage plots",
    text: [
      "The Stage plots page lists the band's plots, each with its lineup, version and a summary like \"11 inputs, 3 mixes, 3 power drops\". Pick a lineup to filter. Admins get \"Add a stage plot\": a name, an optional lineup, and either \"How many inputs?\" (8 to start) or \"Copy from…\" another plot. Nothing is made until you press Add.",
      "A plot's page starts with the input count and the mix count (type a number or use − and +). Each input is a numbered circle that waits in the \"To place\" strip above the stage. Drag it onto the stage, or tap it and then tap the stage. Drag a placed circle back to the strip to unplace it. Gear from the tray (risers, amps, wedges…) is optional context. Arrow keys nudge a focused item by half a foot, R turns gear, Delete removes it.",
      "The channel list has a row per input: source, mic/DI, stand, 48V, who and a note, all optional, saved as you type. Drag rows to reorder and the circles renumber. Mixes work the same way, with a kind (wedge, in-ear, side fill), who and what they want. \"We bring\" and \"We need\" go on the sheet. Download PDF makes the one-page sheet. The version goes up when inputs, mixes, bring/need or the stage size change, not when things are moved. Members can look and download.",
    ].join("\n\n"),
    related: ["showPage", "setlists"],
  },
];
