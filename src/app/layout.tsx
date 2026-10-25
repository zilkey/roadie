import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { FontLoader } from "@/components/FontLoader";
import { appUrl } from "@/lib/app-url";

// Icons come from the file conventions next to this file (favicon.ico, icon.svg, apple-icon.png) and manifest.ts.
export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "Roadie", template: "%s · Roadie" },
  description: "Your music backoffice suite: shows, booking, songs and money for your band.",
  openGraph: { title: "Roadie - Your Music Backoffice Suite", siteName: "Roadie", url: "/", type: "website" },
  twitter: { card: "summary_large_image", title: "Roadie - Your Music Backoffice Suite" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#3a46c4" };

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
