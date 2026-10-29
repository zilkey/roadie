import { z } from "zod";
import { entity, serverMask, id, cents } from "./common";

/** What a project is for: Band (the default bucket), Duo, a release, a tour, a music video, or anything else. */
export const projectKind = z.enum(["band", "duo", "release", "tour", "video", "other"]);
export type ProjectKind = z.infer<typeof projectKind>;
export const projectStatus = z.enum(["open", "closed"]);
export type ProjectStatus = z.infer<typeof projectStatus>;

/**
 * projects/{id}: a bucket every income, expense and payout belongs to (exactly one each; no projectId = the default).
 * A release or tour is attached to a project later (#11, #12); a project carries no tracks, routes or files.
 * Everyone in the band reads projects; admins write them. A project with money on it is closed, never removed; an empty one can be.
 */
export const Project = entity({
  artistId: id,
  kind: projectKind,
  name: z.string().min(1),
  status: projectStatus,
  /** Exactly one project per artist: Band. Money with no projectId belongs here. */
  isDefault: z.boolean().optional(),
});
export const ProjectInput = Project.omit(serverMask);
export type Project = z.infer<typeof Project>;
