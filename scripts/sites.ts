/**
 * Artists' websites from the command line (docs/designs/sites). Until site creation is in Settings:
 *
 *   npx tsx scripts/sites.ts create  --artist <id> [--live <hostingSite>] [--dry-run]   # the two Hosting sites, the site doc, features.sites
 *   npx tsx scripts/sites.ts import  --artist <id> --dir <folder> [--dry-run]           # a folder of site files into the draft
 *   npx tsx scripts/sites.ts publish --artist <id> --site staging|live [--note "…"]     # as the artist's first admin
 *   npx tsx scripts/sites.ts promote --artist <id>
 *   npx tsx scripts/sites.ts status  --artist <id>
 *
 * Against prod: GCLOUD_PROJECT=roadie-prod-iab SITES_HOSTING_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json.
 * Without SITES_HOSTING_PROJECT the in-memory fake Hosting answers (nothing is published). The folder holds index.html, other
 * pages, partials/header.html, partials/footer.html, style.css, site.json and img/… (see the site.write command's help).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";
import { importCtx, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { hostingClient, sitesProject } from "@/server/integrations/hosting";
import { SITE_PATH_RE, kindOfPath } from "@/schema/sites";
import { roleIn } from "@/schema/users";
import { prepareSource, mimeOf } from "@/server/sites/render";
import { createSiteDoc, draftFiles, readSite, removeDraft, saveAsset, writeDraft } from "@/server/sites/store";
import { blockData } from "@/server/sites/blocks";
import { promoteStaging, publishDraft, reconcile } from "@/server/sites/publish";
import { siteStatus } from "@/server/commands/sites";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes("--dry-run");
const artistId = opt("artist");
if (!cmd || !artistId) { console.error("Usage: sites.ts create|import|publish|promote|status --artist <id> …"); process.exit(2); }

async function adminCtx(): Promise<Ctx> {
  const users = await db.list(importCtx(artistId!), "users", (q) => q.where("artistIds", "array-contains", artistId!));
  const admin = users.find((u) => roleIn(u, artistId) === "admin");
  return { ...importCtx(artistId!, admin?.id ?? "import"), via: "app" };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const artist = await db.get(importCtx(artistId!), "artists", artistId!);
  if (!artist) throw new Error(`No artist ${artistId}`);
  const api = hostingClient();
  console.log(`${process.env.GCLOUD_PROJECT ?? "demo"} · Hosting: ${api.real ? sitesProject() : "fake (in memory)"} · ${artist.name}`);

  if (cmd === "create") {
    const live = opt("live") ?? String(artist.slug);
    const staging = `${live}-staging`;
    const project = sitesProject() ?? "demo";
    console.log(`live ${api.hostOf(live)} · staging ${api.hostOf(staging)}`);
    if (dry) return;
    for (const s of [live, staging]) { await api.createSite(project, s); await api.setRetention(s, 100); }
    const ctx = await adminCtx();
    await createSiteDoc(artistId!, String(artist.publicName || artist.name), { project, liveSite: live, stagingSite: staging }, ctx.uid);
    if (!artist.features?.sites) await db.update(ctx, "artists", artistId!, { features: { ...(artist.features ?? {}), sites: true } });
    console.log("created");
    return;
  }

  const site = await readSite(artistId!);
  if (!site) throw new Error("No site: run `sites.ts create` first");
  const ctx = await adminCtx();

  if (cmd === "import") {
    const dir = opt("dir");
    if (!dir) throw new Error("--dir is needed");
    const seen = new Set<string>();
    for (const file of walk(dir).sort()) {
      const path = relative(dir, file).split("\\").join("/");
      if (path.split("/").some((s) => s.startsWith("."))) continue;
      if (!SITE_PATH_RE.test(path)) { console.log(`skip ${path} (not a site path)`); continue; }
      seen.add(path);
      if (kindOfPath(path) === "image") {
        let bytes: Buffer = readFileSync(file);
        if (!path.endsWith(".svg") && !path.endsWith(".gif")) {
          const img = sharp(bytes, { failOn: "none" }).rotate();
          const meta = await img.metadata();
          if ((meta.width ?? 0) > 2000 || bytes.length > 900_000) {
            const resized = img.resize({ width: 2000, withoutEnlargement: true });
            bytes = path.endsWith(".png") ? await resized.png({ compressionLevel: 9 }).toBuffer() : await resized.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
          }
        }
        console.log(`image ${path} ${Math.round(bytes.length / 1024)} KB`);
        if (dry) continue;
        const sha = await saveAsset(artistId!, bytes, mimeOf(path), path, ctx.uid, ctx.runId);
        await writeDraft(ctx, { path, kind: "image", body: sha });
        continue;
      }
      const p = prepareSource(path, readFileSync(file, "utf8"));
      console.log(`${p.kind} ${path}${p.removed.length ? ` (removed: ${p.removed.join(", ")})` : ""}`);
      if (!dry) await writeDraft(ctx, { path, kind: p.kind, body: p.body });
    }
    if (opt("prune") === "yes" && !dry) for (const f of await draftFiles(ctx)) if (!seen.has(f.path)) { await removeDraft(ctx, f.path); console.log(`removed ${f.path}`); }
    console.log(dry ? "dry run: nothing written" : `imported ${seen.size} files (run ${ctx.runId})`);
    return;
  }

  if (cmd === "publish") {
    const target = opt("site") === "live" ? "live" : "staging";
    const r = await publishDraft(ctx, { target, files: await draftFiles(ctx), data: await blockData(ctx), site, note: opt("note") });
    console.log(`version ${r.n} ${r.state} on ${target}: ${r.files} files, ${r.uploaded} uploaded → https://${api.hostOf(target === "live" ? site.hosting.liveSite : site.hosting.stagingSite)}`);
    for (const [p, rm] of Object.entries(r.removed)) console.log(`  ${p}: removed ${rm.join(", ")}`);
    return;
  }
  if (cmd === "promote") {
    const r = await promoteStaging(ctx, { site, data: await blockData(ctx), note: opt("note") });
    console.log(`version ${r.n} ${r.state} on live, ${r.uploaded} uploaded${r.showsChanged ? " (shows changed since staging)" : ""}`);
    return;
  }
  if (cmd === "status") {
    console.log(JSON.stringify(await reconcile(artistId!), null, 1));
    console.log(JSON.stringify(await siteStatus.run(ctx, {}), null, 1));
    return;
  }
  throw new Error(`Unknown command ${cmd}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
