import { AuthProvider } from "@/lib/auth";

/** The one AuthProvider for every route that signs in (/signin, /no-band, /start-band, /not-invited, /artists/...), so auth state survives navigation between them. Public pages (/f, /ask) live outside this group and never load Firebase. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
