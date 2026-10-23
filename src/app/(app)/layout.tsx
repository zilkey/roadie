import { SignedIn } from "@/components/Guard";
import { Shell } from "@/components/Shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SignedIn><Shell>{children}</Shell></SignedIn>;
}
