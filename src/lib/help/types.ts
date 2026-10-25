/** One "explain this to me" topic: hard-coded text Roadie reads back when someone asks what a page or idea is. */
export interface HelpTopic {
  id: string;
  title: string;
  /** Plain words, a few short paragraphs. What it is, what you can do there, what the words mean. Only what the app really does. */
  text: string;
  /** Other topic ids worth offering next. */
  related: string[];
}
