import type { MetadataRoute } from "next";

/** Home-screen install: the road case on Roadie blue (icons in public/, from the logo kit). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roadie",
    short_name: "Roadie",
    description: "Your music backoffice suite",
    // id pins the install's identity (start_url could change later without making a second app); scope keeps every app page inside it.
    id: "/artists",
    start_url: "/artists",
    scope: "/",
    display: "standalone",
    background_color: "#3a46c4",
    theme_color: "#3a46c4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops icons to its own shape (circle, squircle): these leave the case inside the middle 80% so nothing is cut off.
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
