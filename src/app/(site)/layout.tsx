import "./site.css";
import { appUrl } from "@/lib/app-url";

/** The public site: landing, privacy and terms (myroadie.online). No Firebase here; Sign in goes to the app's own host. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const signIn = `${appUrl()}/signin`;
  return (
    <div className="site">
      {/* React hoists this into <head>; the app's own pages use Figtree from FontLoader */}
      <link rel="stylesheet" precedence="default" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500&family=Permanent+Marker&display=swap" />
      <nav className="top band" aria-label="Main">
        <div className="col">
          <a href="/" aria-label="Roadie home"><img src="/logo-header.svg" alt="Roadie" width={115} height={38} /></a>
          <div className="links">
            <a href="/#features">What it does</a>
            <a href="/#money">Money</a>
            <a href="/#open">Open source</a>
            <a className="btn primary" href={signIn} data-testid="site-signin">Sign in</a>
          </div>
        </div>
      </nav>
      {children}
      <footer className="site-foot band">
        <div className="col">
          <img src="/logo-header.svg" alt="Roadie" width={91} height={30} />
          <nav aria-label="Footer">
            <a href="/#features">What it does</a>
            <a href="/#money">Money</a>
            <a href="/#open">Open source</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
          <span>myroadie.online · Free and open source</span>
        </div>
      </footer>
    </div>
  );
}
