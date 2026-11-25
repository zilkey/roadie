import { AuthProvider } from "@/lib/auth";
import { NewVersion } from "@/components/NewVersion";
import { ThemeProvider, ThemeScript } from "@/components/Theme";

/**
 * The one AuthProvider for every route that signs in (/signin, /no-band, /start-band, /not-invited, /artists/...), so auth state survives navigation between them. Public pages (/f, /ask) live outside this group and never load Firebase.
 * NewVersion offers a reload once Roadie has been deployed since the tab loaded. ThemeScript and ThemeProvider apply the
 * person's Auto / Light / Dark choice (avatar menu); the public pages keep following the device.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <><ThemeScript /><AuthProvider><ThemeProvider><NewVersion />{children}</ThemeProvider></AuthProvider></>;
}
