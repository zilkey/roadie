import type { HelpTopic } from "./types";

/** Help text for Tours (#11). Each sentence is checked against the commands. */
export const TOUR_TOPICS: HelpTopic[] = [
  {
    id: "tours",
    title: "Tours",
    text: [
      "A tour is a run of days: it starts as a bucket of pitches and fills in day by day with shows, drives, stays and notes. Tours (in the menu) lists them; + New tour starts one from a name, and its Info tab holds the dates, where you leave from, the act, who's going and notes. Roadie can do it too (\"start a tour called Mountain West\", \"how's the tour doing?\").",
      "A tour is a tag, not a project. Shows, pitches and money carry the tour, and each keeps its own project, so a duo tour's shows stay on Duo and their money still counts there. \"Money goes to\" is only the project that money added from the tour starts on.",
      "The Plan tab is the tour day by day. The + between two entries adds a drive, stay or note right there, or pitches a venue for that date; click a drive, stay or note to change it (changes save as you go), and × takes anything off. Pitches with no date wait in No date yet. Admins can drag venues, pitches and shows from Add to tour onto a day: a venue starts a pitch offering that date. A night with no stay says so, with Add a stay.",
      "Putting a pitch on a tour makes one option for each date it offers (\"add Velour for the 9th or 10th\"); a pitch with no dates sits in \"No date yet\". Options are admins only. Booking an option books the pitch the usual way and the option becomes the show; the other options that day can stay, go, or go with a note to tell them we're booked.",
      "Putting a show on a tour tags the show and its income, expenses and payouts; taking it off removes the tag. Neither ever changes a project. A drive gets its miles and drive time from driving directions.",
      "A tour's numbers are the money tagged with it: received and owed kept apart, and a show that hasn't happened yet only counts once its date passes. The warnings are worked out fresh each time: a night with no stay, an open date, a drive over 5 hours, arriving after load in, and anything outside the tour's dates. Members see the tour's shows, drives, stays and notes, never options or money.",
    ].join("\n\n"),
    related: ["projects", "pitch", "showPage", "income", "expenses"],
  },
];
