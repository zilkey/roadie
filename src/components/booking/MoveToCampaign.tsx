"use client";
import { useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { DialogClose } from "@/components/booking/AddContactDialog";
import { NewCampaignDialog } from "@/components/booking/CampaignsIndex";
import { ONGOING } from "@/lib/campaigns";
import { useCampaigns } from "@/components/booking/useCampaigns";
export { useCampaigns };

/**
 * "Move to a campaign" (#82 S4b): the selection bar's dialog on a campaign page. Every active campaign but the one the pitches
 * are in, Ongoing (takes them out of their campaign), or "New campaign…" (named, then they move into it).
 * testids: `move-campaign-dialog`, `move-campaign-<id|ongoing|new>`, `move-campaign-go`.
 */
export function MoveToCampaignDialog({ open, onClose, pitchIds, from, onDone }: {
  open: boolean; onClose(): void; pitchIds: string[]; /** The page's campaign (not offered). */ from?: string; onDone(msg: string): void;
}) {
  const { call, error, busy } = useCommand();
  const { active } = useCampaigns();
  const [pick, setPick] = useState<string>("");
  const [naming, setNaming] = useState(false);
  const choices = [...active.filter((c) => c.id !== from).map((c) => ({ key: c.id, label: c.name })), ...(from && from !== ONGOING ? [{ key: ONGOING, label: "Ongoing (no campaign)" }] : [])];
  const n = pitchIds.length;
  const what = `${n} ${n === 1 ? "pitch" : "pitches"}`;

  async function move(key: string, name: string) {
    const r = await call("pitches.setCampaign", { ids: pitchIds, campaignId: key === ONGOING ? null : key });
    if (!r) return;
    onDone(`Moved ${what} to ${name}.`);
    setPick("");
    onClose();
  }

  return (<>
    <Dialog open={open && !naming} onClose={onClose} title={`Move ${what} to`} testid="move-campaign-dialog">
      <DialogClose onClose={onClose} testid="move-campaign-close" />
      <div className="grid gap-1" role="radiogroup" aria-label="Campaign">
        {choices.map((c) => (
          <label key={c.key} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 font-semibold hover:bg-page">
            <input type="radio" name="move-campaign" className="h-[18px] w-[18px]" checked={pick === c.key} onChange={() => setPick(c.key)} data-testid={`move-campaign-${c.key}`} />{c.label}
          </label>
        ))}
        <label className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 font-semibold hover:bg-page">
          <input type="radio" name="move-campaign" className="h-[18px] w-[18px]" checked={pick === "new"} onChange={() => setPick("new")} data-testid="move-campaign-new" />New campaign…
        </label>
      </div>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn acc" disabled={!pick || busy} data-testid="move-campaign-go"
          onClick={() => pick === "new" ? setNaming(true) : void move(pick, choices.find((c) => c.key === pick)?.label ?? "")}>Move</button>
      </div>
    </Dialog>
    <NewCampaignDialog open={open && naming} onClose={() => setNaming(false)} onCreated={(id, name) => { setNaming(false); void move(id, name); }} />
  </>);
}

/**
 * A pitch's campaign on its page (#82 S4b): a select of the active campaigns and Ongoing. A pitch in a closed campaign shows it
 * (disabled: you can't move into a closed one) until it is moved.
 */
export function PitchCampaignPicker({ pitchId, campaignId }: { pitchId: string; campaignId?: string | null }) {
  const { call, error, busy } = useCommand();
  const { live, active } = useCampaigns();
  const current = campaignId ? live.get(campaignId) : undefined;
  const value = current ? current.id : ONGOING;
  return (
    <label className="grid gap-1.5" data-testid="pitch-campaign">
      <span className="lbl">Campaign</span>
      <select className="select" value={value} disabled={busy} aria-label="Campaign" data-testid="pitch-campaign-select"
        onChange={(e) => void call("pitches.setCampaign", { ids: [pitchId], campaignId: e.target.value === ONGOING ? null : e.target.value })}>
        <option value={ONGOING}>Ongoing (no campaign)</option>
        {current && current.status === "closed" && <option value={current.id} disabled>{current.name} (closed)</option>}
        {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <ErrorBox error={error} />
    </label>
  );
}
