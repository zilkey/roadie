import { SignedIn } from "@/components/Guard";
import { ToastHost } from "@/components/Toasts";
import { CelebrateHost } from "@/components/Celebrate";

/** Signed-in pages: the artist picker (/artists) and every artist's pages (/artists/[slug]/..., which add the Shell). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SignedIn>{children}<ToastHost /><CelebrateHost /></SignedIn>;
}
