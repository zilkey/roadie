import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy", description: "What Roadie stores, who can see it, and how to get it removed." };

/** Plain-language privacy policy. Keep it true to the code: update it when a new service starts seeing user data. */
export default function Privacy() {
  return (
    <main className="legal band">
      <article className="col">
        <h1>Privacy policy</h1>
        <p className="eff">Effective October 26, 2026</p>
        <p className="intro">Roadie is a free, open-source app for the business side of a band. It&apos;s run by Jeff Dean. This page explains what Roadie stores, who can see it, and how to have it removed. Questions go to <a href="mailto:jeff@zilkey.com">jeff@zilkey.com</a>.</p>

        <h2>What Roadie collects</h2>
        <ul>
          <li><b>Your Google account basics.</b> Signing in with Google gives Roadie your name and email address. Signing in alone gives Roadie no access to your Gmail, Calendar, Drive or contacts.</li>
          <li><b>Gmail, if a band admin connects it.</b> An admin can connect their Gmail so Roadie can send booking emails and pitches from it, save drafts there, and read the replies in those threads. Roadie only reads threads it started or that you point it to.</li>
          <li><b>Google Calendar, if a band admin connects it.</b> Roadie adds, changes and removes the events for your band&apos;s shows and rehearsals on that calendar, and Google emails the invites to band members.</li>
          <li><b>What your band puts in.</b> Shows, venues, booking contacts, pitches, songs, setlists, rehearsals, tours, stage plots, income, expenses and notes, and the email addresses admins use to invite band members.</li>
          <li><b>Availability answers.</b> When a band sends a &ldquo;can you play?&rdquo; link, the yes or no you give for each date.</li>
          <li><b>Fan sign-ups.</b> If a band has a fan sign-up page, fans who join give an email address, and can add a first name and city.</li>
          <li><b>Assistant conversations.</b> What you type to the Roadie assistant, and its replies.</li>
          <li><b>Technical basics.</b> Your sign-in session and unsaved form drafts, kept in your browser, and standard server logs (IP address, browser, time) kept by Google Cloud.</li>
        </ul>

        <h2>How it&apos;s used</h2>
        <p>Only to run Roadie for you and your band. Roadie has no ads, no analytics or tracking scripts, and doesn&apos;t sell, rent or trade anyone&apos;s data.</p>

        <h2>Who can see it</h2>
        <ul>
          <li><b>Your band.</b> Admins see everything for their band. Members see shows, songs, setlists, their own expenses and their own payments. Only admins see fan email addresses.</li>
          <li><b>Other bands on Roadie.</b> Basic venue facts (name, address, capacity and similar) are shared by every band that books that venue, so one band&apos;s fix helps everyone. Your band&apos;s notes about a venue stay with your band.</li>
          <li><b>Jeff, as the operator,</b> can reach the database to keep Roadie running and fix problems, and only uses that access for those reasons.</li>
          <li><b>The services below</b>, each only for its part of the job.</li>
        </ul>

        <h2>Services Roadie relies on</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Service</th><th>What it receives</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>Google Firebase and Google Cloud (United States)</td><td>Everything above</td><td>Hosting, sign-in and the database</td></tr>
              <tr><td>Gmail and Google Calendar (when an admin connects them)</td><td>The emails and events Roadie sends, drafts or updates, and the replies it reads</td><td>Booking emails and band calendar invites</td></tr>
              <tr><td>Google Vertex AI (Gemini)</td><td>Your messages to the assistant and the band data it needs to answer</td><td>The built-in assistant</td></tr>
              <tr><td>OpenRouteService</td><td>Addresses you look up or travel between</td><td>Address search and driving distances for gas estimates</td></tr>
              <tr><td>U.S. Energy Information Administration</td><td>Nothing about you</td><td>Roadie downloads weekly gas prices</td></tr>
              <tr><td>Google Fonts</td><td>Your IP address when a page loads its fonts</td><td>Typefaces</td></tr>
              <tr><td>A chatbot you connect (such as Claude)</td><td>Whatever you ask it to read or change in Roadie</td><td>Using Roadie from that chatbot; its own privacy policy applies</td></tr>
            </tbody>
          </table>
        </div>
        <p>Roadie doesn&apos;t send fan addresses anywhere. A band&apos;s admins may copy them into their own mailing-list service.</p>

        <h2>Data from Google</h2>
        <p>Roadie&apos;s use and transfer of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements. Gmail and Calendar data is used only to run the booking and calendar features you turned on, is never used for ads, is never sold, and is never used to train AI models. A person sees it only when you ask, to fix a problem, for security, or when the law requires it. An admin can disconnect Gmail or Calendar at any time from their <a href="https://myaccount.google.com/connections">Google account settings</a>.</p>

        <h2>Keeping and deleting</h2>
        <ul>
          <li>Your band&apos;s data is kept while your band uses Roadie. Things you delete in the app are hidden first so they can be undone.</li>
          <li>To get a copy of your data, or to have your account or your band&apos;s data deleted for good, email <a href="mailto:jeff@zilkey.com">jeff@zilkey.com</a>. Deletion is done within 30 days; backups that still hold it are replaced over time.</li>
          <li>Fans can ask the band, or email the address above, to be taken off a band&apos;s list.</li>
        </ul>

        <h2>Children</h2>
        <p>Roadie isn&apos;t meant for anyone under 13, and doesn&apos;t knowingly collect their information.</p>

        <h2>Changes</h2>
        <p>If this policy changes, this page will show the new version and its date. Big changes will also be announced in the app before they take effect.</p>

        <h2>Contact</h2>
        <p>Jeff Dean, <a href="mailto:jeff@zilkey.com">jeff@zilkey.com</a></p>
      </article>
    </main>
  );
}
