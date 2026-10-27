import { connection } from "next/server";
import { StartBandForm } from "./StartBandForm";

/** Name your band. The Terms link is on the site host (SITE_URL), read per request. */
export default async function StartBand() {
  await connection();
  const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  return <StartBandForm termsUrl={`${site}/terms`} />;
}
