/**
 * Server-rendered content for the Connect-to-Claude page. Only page.tsx (a Server Component) imports this file,
 * so none of it is in the client bundle; DevelopersGuide is rendered only for localhost requests.
 */

function Code({ children, testid }: { children: string; testid?: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-soft p-3 text-sm font-mono whitespace-pre-wrap break-all" data-testid={testid}>{children}</pre>;
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-base font-bold">{children}</h2>;
}

const Inline = ({ children }: { children: string }) => <code className="rounded bg-soft px-1 font-mono text-xs">{children}</code>;

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="s grid list-decimal gap-1.5 pl-5">{children}</ol>;
}

// ---------- Users ----------

const EXAMPLES = [
  { label: "Follow-ups", prompt: "Which pitches haven't heard from us in over two weeks? Draft a friendly follow-up email for each one." },
  { label: "Before you pitch dates", prompt: "Is everyone free on March 14, 15 and 16? I want to offer those dates to a venue." },
  { label: "Show recap", prompt: "Summarize our last 5 shows: venues, deals, and how much we made." },
  { label: "Song files", prompt: "Which songs are missing a chart or a demo? List them." },
  { label: "Bandsintown check", prompt: "Are all our confirmed upcoming shows listed on Bandsintown? Flag anything that doesn't match." },
  { label: "Release stats", prompt: "How did our Spotify followers and monthly listeners change in the two weeks after our last release?" },
];

export function UsersGuide({ connectorUrl }: { connectorUrl: string }) {
  return (
    <div className="grid gap-5" data-testid="mcp-users">
      <div className="card grid gap-3">
        <H>What this does</H>
        <p className="s">
          Connecting Roadie to Claude lets you talk to your band&apos;s data in plain English. Claude can look up venues,
          promoters, festivals, shows, songs and who&apos;s available, and it can add or update things for you, following the
          same rules as the app.
        </p>
        <ul className="s grid list-disc gap-1 pl-4">
          <li>Everything Claude changes is recorded in History, and you can ask it to undo its own changes.</li>
          <li>It can draft emails, but it never sends them. You review and send drafts from Roadie yourself.</li>
          <li>It can&apos;t change band members, logins or admin settings.</li>
        </ul>
      </div>

      <div className="card grid gap-3">
        <H>Before you start</H>
        <Steps>
          <li>Ask a band admin to turn on <b>AI access</b> for your account.</li>
          <li>
            Ask them for your personal <b>Roadie key</b>. It starts with <Inline>btk_</Inline>. Treat it like a password:
            don&apos;t share it or paste it anywhere other than Claude.
          </li>
        </Steps>
        <p className="s">You&apos;ll also need a Claude account. Custom connectors are available on Claude&apos;s paid plans.</p>
      </div>

      <div className="card grid gap-3" data-testid="mcp-claude-app">
        <H>Connect in Claude (web or desktop app)</H>
        <Steps>
          <li>Open Claude at claude.ai or in the Claude desktop app.</li>
          <li>Go to <b>Settings</b>, then <b>Connectors</b>, and choose <b>Add custom connector</b>.</li>
          <li>Name it <b>Roadie</b> and paste this address:</li>
        </Steps>
        <Code testid="mcp-connector-url">{connectorUrl}</Code>
        <Steps>
          <li value={4}>Save, then follow the prompts to sign in with your Roadie key.</li>
          <li>In a new chat, open the tools menu and make sure <b>Roadie</b> is switched on.</li>
        </Steps>
        <p className="s">A connector you add on claude.ai also shows up in the Claude desktop app when you&apos;re signed in to the same account.</p>
      </div>

      <div className="card grid gap-3" data-testid="mcp-claude-code">
        <H>Connect in Claude Code</H>
        <p className="s">If you use Claude Code in a terminal, run this once, with your own key in place of <Inline>btk_YOUR_KEY</Inline>:</p>
        <Code>{`claude mcp add --transport http roadie ${connectorUrl} --header "Authorization: Bearer btk_YOUR_KEY"`}</Code>
        <p className="s">Then type <Inline>/mcp</Inline> inside Claude Code to check that Roadie shows as connected.</p>
      </div>

      <div className="card grid gap-3">
        <H>Things to ask</H>
        <div className="grid gap-2">
          {EXAMPLES.map((ex) => (
            <div key={ex.label} className="grid gap-1">
              <span className="lbl">{ex.label}</span>
              <Code>{ex.prompt}</Code>
            </div>
          ))}
        </div>
        <p className="s">Changed your mind? Say &ldquo;undo what you just did in Roadie&rdquo; and Claude will put things back.</p>
      </div>

      <div className="card grid gap-3">
        <H>Staying safe</H>
        <ul className="s grid list-disc gap-1 pl-4">
          <li>Claude acts as you. Anything it adds or edits is credited to you in History.</li>
          <li>Lost your key, or think someone else has it? Tell a band admin and they&apos;ll switch it off right away.</li>
          <li>To disconnect, remove the Roadie connector in Claude&apos;s settings.</li>
        </ul>
      </div>
    </div>
  );
}

// ---------- Developers (localhost only) ----------

export function DevelopersGuide() {
  return (
    <div className="grid gap-5" data-testid="mcp-developers">
      <div className="card grid gap-3">
        <span className="chip m w-fit">Only shown on localhost</span>
        <p className="s">
          The MCP server lives in <Inline>mcp/</Inline> and exposes every registry command whose roles include <Inline>mcp</Inline>,
          plus read tools (search, records, availability, stats, history). It reads and writes whatever Firestore the environment
          points at: the local emulators by default. Full notes: <Inline>docs/MCP.md</Inline>.
        </p>
      </div>

      <div className="card grid gap-3">
        <H>1. Get a key</H>
        <p className="s">
          The user needs <b>AI access</b> (Admin › People). Keys are <Inline>btk_…</Inline> tokens stored hashed (SHA-256) in
          the <Inline>mcpTokens</Inline> collection; a revoked key stops working at once, even mid-session.
        </p>
      </div>

      <div className="card grid gap-3">
        <H>2. Where it runs</H>
        <p className="s">
          The app serves it: Streamable HTTP at <Inline>/mcp</Inline> (<Inline>src/app/mcp/route.ts</Inline> → <Inline>mcp/web.ts</Inline>), so the dev
          server (<Inline>npm run dev</Inline> with the emulators and seed) already answers at <Inline>http://127.0.0.1:3100/mcp</Inline>. It is
          stateless: the session id is the signed runId, so production needs the <Inline>MCP_SESSION_SECRET</Inline> secret.
        </p>
      </div>

      <div className="card grid gap-3">
        <H>3. Connect Claude Code</H>
        <p className="s">HTTP (one shared server):</p>
        <Code>{`claude mcp add --transport http band-tracker http://127.0.0.1:3100/mcp \\\n  --header "Authorization: Bearer btk_YOUR_KEY"`}</Code>
        <p className="s">Or stdio (Claude Code starts the server itself; the key goes in <Inline>MCP_TOKEN</Inline>):</p>
        <Code>{"claude mcp add band-tracker --env MCP_TOKEN=btk_YOUR_KEY -- npm --prefix /path/to/band-tracker run --silent mcp:stdio"}</Code>
        <p className="s">Use one or the other, not both. Run <Inline>/mcp</Inline> inside Claude Code to check it connected.</p>
      </div>

      <div className="card grid gap-3">
        <H>Limits</H>
        <ul className="s grid list-disc gap-1 pl-4">
          <li>Not tools: users, musicians admin, AI keys, <Inline>pitches.sendEmail</Inline>, <Inline>availability.mark</Inline>, archiving.</li>
          <li><Inline>pitches.draftEmail</Inline> makes a Gmail draft; the user sends it from the app.</li>
          <li>One MCP session = one <Inline>runId</Inline>; <Inline>history.undoRun</Inline> reverts the caller&apos;s own runs. Admins can undo any run in Admin › History.</li>
          <li>Pointing at production needs <Inline>GOOGLE_APPLICATION_CREDENTIALS</Inline> and <Inline>GCLOUD_PROJECT=roadie-prod-iab</Inline>.</li>
        </ul>
      </div>
    </div>
  );
}
