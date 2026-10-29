import { z } from "zod";
import { entity, serverMask, id, dateStr, cents } from "./common";

/** What a project is for: Band (the default bucket), Duo, an album, a tour, a music video, or anything else. */
export const projectKind = z.enum(["band", "duo", "album", "tour", "video", "other"]);
export type ProjectKind = z.infer<typeof projectKind>;
export const projectStatus = z.enum(["open", "closed"]);
export type ProjectStatus = z.infer<typeof projectStatus>;

/**
 * projects/{id}: a bucket every income, expense and payout belongs to (exactly one each; no projectId = the default).
 * An album or tour is attached to a project later (#11, #12); a project carries no tracks, routes or files.
 * Everyone in the band reads projects; admins write them. A project with money on it is closed, never removed.
 */
export const Project = entity({
  artistId: id,
  kind: projectKind,
  name: z.string().min(1),
  start: dateStr.optional(),
  end: dateStr.optional(),
  status: projectStatus,
  /** Planned spend, cents. */
  budget: cents.nonnegative().optional(),
  /** Exactly one project per artist: Band. Money with no projectId belongs here. */
  isDefault: z.boolean().optional(),
});
export const ProjectInput = Project.omit(serverMask);
export type Project = z.infer<typeof Project>;
