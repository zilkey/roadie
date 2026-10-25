import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Link previews (Signal, iMessage, Slack): the road case from the logo kit on Roadie blue, with the tagline. */
export const alt = "Roadie - Your Music Backoffice Suite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/logo-signin.svg"), "base64");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36, background: "#3a46c4" }}>
        <img src={`data:image/svg+xml;base64,${logo}`} width={520} height={380} alt="" />
        <div style={{ fontSize: 44, fontWeight: 700, color: "#ffffff" }}>Your Music Backoffice Suite</div>
      </div>
    ),
    size,
  );
}
