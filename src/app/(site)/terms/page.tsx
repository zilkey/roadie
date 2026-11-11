import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service", description: "The terms for using Roadie." };

/** Plain-language terms of service. The privacy policy (/privacy) covers what happens to data. */
export default function Terms() {
  return (
    <main className="legal band">
      <article className="col">
        <h1>Terms of service</h1>
        <p className="eff">Effective October 26, 2026</p>
        <p className="intro">These terms are an agreement between you and Jeff Dean, who runs Roadie. By using Roadie you accept them. The <a href="/privacy">privacy policy</a> explains what happens to your data.</p>

        <h2>Roadie</h2>
        <p>Roadie is a free, open-source app for running the business side of a band. Features may change, be added or be removed. Using Roadie is free. If a cost share is ever introduced, it will be announced with numbers before it starts, and paying will never be a condition of using Roadie.</p>

        <h2>Your account</h2>
        <ul>
          <li>You sign in with a Google account, usually after a band admin invites you.</li>
          <li>You must be at least 13 to use Roadie.</li>
          <li>You&apos;re responsible for what happens under your account. Tell <a href="mailto:jeff@zilkey.com">jeff@zilkey.com</a> if you think someone else is using it.</li>
        </ul>

        <h2>Your content</h2>
        <ul>
          <li>What you and your band put into Roadie stays yours.</li>
          <li>You give Roadie permission to store it, show it to the people your band shares it with, and pass it to the services named in the privacy policy, only to run Roadie for you.</li>
          <li>Basic venue facts you add or fix are shared with every band on Roadie. Your band&apos;s notes about a venue are not.</li>
          <li>Only put in content you have the right to share.</li>
        </ul>

        <h2>Band admins</h2>
        <p>Admins decide who joins their band in Roadie and what they can see. Admins who collect fan sign-ups are responsible for how they use those addresses, including following anti-spam laws when they email fans.</p>

        <h2>Acceptable use</h2>
        <p>Don&apos;t use Roadie to break the law, send spam, harass anyone, upload malware, reach data that isn&apos;t yours, or overload or scrape the service.</p>

        <h2>The assistant</h2>
        <p>The Roadie assistant uses AI and can get things wrong. Check dates, money and anything you&apos;re about to send before relying on it.</p>

        <h2>Open source</h2>
        <p>Roadie&apos;s code is open source. If you run your own copy, the code&apos;s license applies to it, not these terms.</p>

        <h2>Ending</h2>
        <ul>
          <li>You can stop using Roadie at any time and ask for your data to be deleted.</li>
          <li>Accounts that break these terms may be suspended or removed.</li>
          <li>If Roadie ever shuts down, users will get at least 30 days&apos; notice and a way to export their band&apos;s data.</li>
        </ul>

        <h2>No warranty</h2>
        <p>Roadie is provided &ldquo;as is&rdquo;, without warranties of any kind, including that it will be available, error-free or fit for a particular purpose.</p>

        <h2>Limits on liability</h2>
        <p>To the extent the law allows, Jeff Dean isn&apos;t liable for indirect, incidental or consequential damages, or for lost income, gigs or data, arising from using Roadie. Total liability for any claim is limited to $50.</p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the State of Colorado. Any dispute will be handled in the state or federal courts located in Colorado.</p>

        <h2>Changes</h2>
        <p>If these terms change, this page will show the new version and its date. Big changes will also be announced in the app before they take effect. Using Roadie after that means you accept the new terms.</p>

        <h2>Contact</h2>
        <p>Jeff Dean, <a href="mailto:jeff@zilkey.com">jeff@zilkey.com</a></p>
      </article>
    </main>
  );
}
