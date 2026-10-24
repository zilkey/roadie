import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { FontLoader } from "@/components/FontLoader";

export const metadata: Metadata = { title: "Roadie", description: "Ingrid Avison Band: booking, shows, songs and money." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FontLoader />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
