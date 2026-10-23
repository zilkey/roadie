// Entry for the Genkit Developer UI (`npm run genkit:ui`): registers the flow so you can run it by hand.
import { getChatFlow } from "./flow";

getChatFlow().then(() => console.log("assistant.chat ready (ROADIE_MODEL=" + (process.env.ROADIE_MODEL ?? "default") + ")"));
