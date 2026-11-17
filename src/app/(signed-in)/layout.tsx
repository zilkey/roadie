import { AuthProvider } from "@/lib/auth";
import { NewVersion } from "@/components/NewVersion";

/**
 * The one AuthProvider for every route that signs in (/signin, /no-band, /start-band, /not-invited, /artists/...), so auth state survives navigation between them. Public pages (/f, /ask) live outside this group and never load Firebase.
 * NewVersion offers a reload once Roadie has been deployed since the tab loaded.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><NewVersion />{children}</AuthProvider>;
}
