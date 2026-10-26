import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { ARTISTS_PATH } from "@/lib/routes";
import { CostShareCalc } from "./CostShareCalc";

export const metadata: Metadata = {
  description: "Roadie keeps the business side of your band in one place: booking, setlists, rehearsals, tours and money. Free and open source.",
};

/**
 * `/` is two pages by host: on the app's own host (APP_URL, app.myroadie.online) it is your artist, as before; anywhere
 * else (myroadie.online, or localhost in dev) it is the landing page. next.config.ts sends myroadie.online's other paths to the app.
 */
export default async function Home() {
  const h = await headers();
  if ((h.get("x-forwarded-host") ?? h.get("host")) === new URL(appUrl()).host) redirect(ARTISTS_PATH);
  const signIn = `${appUrl()}/signin`;
  return (
    <>
      <header className="hero band" id="top">
        <div className="col">
          <div>
            <h1>The business side of your band, <span className="mk">handled.</span></h1>
            <p className="lede">Indie musicians do a million jobs before they play a note. Roadie keeps booking, setlists, rehearsals, tours and money in one place, so you can get back to the music.</p>
            <div className="ctas">
              <a className="btn primary" href={signIn}>Sign in with Google</a>
              <a className="btn ghost" href="#money">Why it&apos;s free</a>
            </div>
            <p className="fine">Free and open source. Built by a working musician.</p>
          </div>
          <figure><img src="/logo-signin.svg" alt="A road case with gaffer tape across it that reads Roadie" width={420} height={307} /></figure>
        </div>
      </header>

      <section className="jobs band" aria-labelledby="jobs-h">
        <div className="col">
          <div>
            <p className="mono" style={{ color: "#8f8c84" }}>The job description</p>
            <h2 id="jobs-h" style={{ marginTop: 12 }}>You&apos;re not just a band.</h2>
            <p className="lede">You&apos;re also the booking agent, accountant, tour manager, designer and social team. And somebody still has to write the songs.</p>
          </div>
          <ul className="joblist">
            {["Research venues", "Pitch shows", "Negotiate fees", "Check who's free", "Build setlists", "Run rehearsals", "Track the money", "Plan tours"].map((job, i) => (
              <li key={job}><span className="n">{String(i + 1).padStart(2, "0")}</span>{job}</li>
            ))}
            <li className="soon"><span className="n">09</span>Make posters <em>Coming</em></li>
            <li className="soon"><span className="n">10</span>Post to social <em>Coming</em></li>
          </ul>
        </div>
      </section>

      <section className="features band" id="features" aria-labelledby="feat-h">
        <div className="col">
          <header>
            <p className="mono" style={{ color: "var(--muted)" }}>What Roadie does</p>
            <h2 id="feat-h">One place instead of four spreadsheets and a group chat.</h2>
          </header>
          <div className="fgrid">
            <article className="f">
              <span className="mono">Booking</span>
              <h3>Venues and pitches</h3>
              <p>Keep notes on every venue, festival and concert series. Track each pitch from first email to booked show, and see which ones are waiting on a reply.</p>
            </article>
            <article className="f wide">
              <span className="mono">Availability</span>
              <h3>&ldquo;Is everyone free on the 14th?&rdquo;</h3>
              <p>Add the possible dates, send one link by Signal or email, and everyone taps yes or no per date. You get a table instead of 47 messages.</p>
              <table className="avail" aria-label="Example availability">
                <thead><tr><th></th><th>Fri 14</th><th>Sat 15</th><th>Fri 21</th></tr></thead>
                <tbody>
                  <tr><td>Drums</td><td className="y">Yes</td><td className="n">No</td><td className="y">Yes</td></tr>
                  <tr><td>Bass</td><td className="y">Yes</td><td className="y">Yes</td><td className="y">Yes</td></tr>
                  <tr><td>Keys</td><td className="n">No</td><td className="y">Yes</td><td className="y">Yes</td></tr>
                </tbody>
              </table>
            </article>
            <article className="f">
              <span className="mono">Deals</span>
              <h3>Fees in writing</h3>
              <p>Guarantee, door deal or versus: log it with the show and check it against what you actually got paid.</p>
            </article>
            <article className="f">
              <span className="mono">Setlists</span>
              <h3>No more napkins</h3>
              <p>Build setlists from your song library. Save templates for the 45-minute set, the 90-minute set and the duo night.</p>
            </article>
            <article className="f">
              <span className="mono">Lineups</span>
              <h3>Duo tonight, full band Saturday</h3>
              <p>One booking book, a different lineup per show, set as late as the day before.</p>
            </article>
            <article className="f">
              <span className="mono">Rehearsals</span>
              <h3>The gig nobody pays you for</h3>
              <p>Where, when, who&apos;s coming, songs pulled from a setlist, recordings in Google Drive, and the gas money.</p>
            </article>
            <article className="f">
              <span className="mono">Tours</span>
              <h3>The whole run in one place</h3>
              <p>Turn pitches into dates, add drives and lodging, and give every show a day sheet.</p>
              <dl className="daysheet" aria-label="Example day sheet">
                <dt>Load in</dt><dd>4:00</dd><dt>Soundcheck</dt><dd>5:30</dd><dt>Doors</dt><dd>7:00</dd><dt>Downbeat</dt><dd>8:15</dd>
              </dl>
            </article>
            <article className="f">
              <span className="mono">Money</span>
              <h3>Who paid for the gas?</h3>
              <p>Log show income as it comes in: cash, checks, the tip jar. Everyone logs their own expenses, and Roadie works out gas from the route, your MPG and local prices. Settle up after tour without a fight.</p>
            </article>
            <article className="f">
              <span className="mono">Assistant</span>
              <h3>Just tell Roadie</h3>
              <p>Talk to the built-in assistant or the chatbot you already use.</p>
              <div className="chat" aria-label="Example conversation">
                <span>Crowd was about 80. Got $400 cash.</span>
                <span className="r">Logged for tonight&apos;s show.</span>
              </div>
            </article>
            <article className="f wide">
              <span className="mono">Your band</span>
              <h3>The right info for each person</h3>
              <p>Admins run booking, pitches and the full books. Band members see shows, songs, setlists, their own expenses and their payments. Everyone signs in with Google.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="money band" id="money" aria-labelledby="money-h">
        <div className="col">
          <div>
            <p className="mono" style={{ color: "var(--amber)" }}>The business plan</p>
            <h2 id="money-h" style={{ marginTop: 12 }}><span className="mk">I don&apos;t want your money.</span></h2>
            <p className="lede">Not a subscription, and not a cut of your gigs. Roadie is open source and built to break even, not to make a profit. Every month I publish what it costs to run, and here&apos;s who pays that bill, in order.</p>
          </div>
          <ol className="ladder">
            <li><h3>I pay it</h3><p>While the bill is small, I cover it.</p></li>
            <li><h3>Grants</h3><p>Arts councils, open source funds and music organizations. If a grant covers hosting, nobody pays.</p></li>
            <li><h3>Cost share</h3><p>Only if grants fall short: a recent bill divided by active artists, charged every few months so card fees don&apos;t eat it.</p></li>
          </ol>
          <div className="mgrid">
            <ul className="promises">
              <li><span><b>Cost share isn&apos;t a price.</b> When the bill drops, your share drops. When a grant lands, it pauses.</span></li>
              <li><span><b>Can&apos;t pay? Same app.</b> No locked features, no paywall, no pro tier.</span></li>
              <li><span><b>No investors, no ads, no selling your data.</b> Nobody can buy Roadie and jack up the price.</span></li>
              <li><span><b>Your files stay in your Google Drive</b>, so the usual biggest cost isn&apos;t even on the bill.</span></li>
              <li><span><b>If it gets big, it becomes a nonprofit.</b> Any salaries go on the same public bill, and any change is announced with numbers before it happens.</span></li>
            </ul>
            <CostShareCalc />
          </div>
        </div>
      </section>

      <section className="open band" id="open" aria-labelledby="open-h">
        <div className="col">
          <div>
            <span className="tape">Copy it.</span>
            <h2 id="open-h" style={{ marginTop: 20 }}>Open source, no restrictions.</h2>
            <p className="lede">The code, the design and the ideas are yours to take. If someone builds something better from it, that&apos;s a win for musicians.</p>
          </div>
          <ul className="list">
            <li><b>Run your own copy</b><span>One Firebase project per band. Host it yourself and pay your own bill.</span></li>
            <li><b>Export everything, any time</b><span>Your band&apos;s data never gets locked away.</span></li>
            <li><b>Built in public</b><span>The cost page and the changelog are public. You can see what I built, what it cost, and what broke.</span></li>
            <li><b>Musicians should own their tools</b><span>Not rent them from a company that might raise the price or get bought.</span></li>
          </ul>
        </div>
      </section>

      <section className="next band" aria-labelledby="next-h">
        <div className="col">
          <div>
            <p className="mono" style={{ color: "#8f8c84" }}>On the roadmap</p>
            <h2 id="next-h" style={{ marginTop: 12 }}>What&apos;s next.</h2>
            <p className="lede">I&apos;m building what working musicians ask for. These are coming, not here yet.</p>
          </div>
          <div className="chips">
            {["Printable setlists", "Scheduled posts to Instagram, Facebook, YouTube and TikTok", "Stage plots for venues", "Fan sign-up QR codes", "Merch links", "Albums"].map((c) => <span key={c}>{c}</span>)}
          </div>
        </div>
      </section>

      <section className="why band" aria-labelledby="why-h">
        <div className="col">
          <h2 id="why-h" className="mono" style={{ fontSize: 13, letterSpacing: ".06em", color: "var(--muted)" }}>Why I&apos;m doing this</h2>
          <blockquote>I&apos;m a working musician. I book my own shows and load my own gear. I got tired of tools that take a cut, raise the price, or get bought, so I&apos;m building the one I wanted, <span className="mk">in the open.</span></blockquote>
          <p className="sig">Named after the hardest-working person on any tour: the one who loads in, runs cable and tapes the setlist to the stage, so the band can just play.</p>
          <div className="ctas">
            <a className="btn primary" href={signIn}>Sign in with Google</a>
            <a className="btn ghost" href="#open">Read the code</a>
          </div>
        </div>
      </section>
    </>
  );
}
