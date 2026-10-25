import type { MetadataRoute } from "next";

/** Home-screen install: the road case on Roadie blue (icons in public/, from the logo kit). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roadie",
    short_name: "Roadie",
    description: "Your music backoffice suite",
    start_url: "/",
    display: "standalone",
    background_color: "#3a46c4",
    theme_color: "#3a46c4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
