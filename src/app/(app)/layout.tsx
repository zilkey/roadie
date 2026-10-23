import { SignedIn } from "@/components/Guard";
import { Shell } from "@/components/Shell";
import { ToastHost } from "@/components/Toasts";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SignedIn><Shell>{children}</Shell><ToastHost /></SignedIn>;
}
