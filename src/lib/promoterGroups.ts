/**
 * Campaign pages nest venues under the promoter that books them (#82 S5). Grouped by the venue side of the link
 * (`venue.promoterIds`, what listRows already reads as `promoters`); a venue with two or more promoters goes under the first
 * (Q3). A promoter's own pitch is the group row's pitch. Venues with no promoter, festival years and lone rows stay top-level.
 * A group forms when a promoter has 2+ venues on the page, or 1+ and its own pitch: one venue alone keeps its "promoted by" line.
 * A group sits where its first member was, so the page's order holds.
 */
export interface GroupableRow { kind: string; id: string; promoters: { id: string; name: string }[] }

export type Grouped<R extends GroupableRow> =
  | { type: "row"; row: R }
  | { type: "group"; promoter: { id: string; name: string }; own?: R; children: R[] };

export function groupByPromoter<R extends GroupableRow>(rows: readonly R[]): Grouped<R>[] {
  const lead = (r: R) => (r.kind === "venue" ? r.promoters[0] : undefined);
  const kids = new Map<string, R[]>();
  for (const r of rows) { const p = lead(r); if (p) kids.set(p.id, [...(kids.get(p.id) ?? []), r]); }
  const own = new Map(rows.filter((r) => r.kind === "promoter").map((r) => [r.id, r]));
  const grouped = (id: string) => { const n = kids.get(id)?.length ?? 0; return n >= 2 || (n >= 1 && own.has(id)); };

  const out: Grouped<R>[] = [];
  const placed = new Set<string>();
  for (const r of rows) {
    const gid = r.kind === "promoter" ? r.id : lead(r)?.id;
    if (!gid || !grouped(gid)) { out.push({ type: "row", row: r }); continue; }
    if (placed.has(gid)) continue;
    placed.add(gid);
    const children = kids.get(gid)!;
    out.push({ type: "group", promoter: children[0].promoters[0], own: own.get(gid), children });
  }
  return out;
}
