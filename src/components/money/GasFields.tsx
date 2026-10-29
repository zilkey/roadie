"use client";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/auth";
import { ErrorBox, useCommand } from "@/components/ui";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { runCommand } from "@/lib/commands";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import { formatCents } from "@/lib/money";
import type { Rehearsal, User } from "@/schema";

/** What expenses.estimateGas replies with (numbers, or `missing`; never an address). */
interface Estimate {
  missing: ("mpg" | "home" | "destination" | "price")[];
  fromKind: "home" | "typed"; roundTrip: boolean;
  oneWayMiles?: number; miles?: number; mpg?: number; grade?: "regular" | "midgrade" | "premium" | "diesel";
  priceMilli?: number; priceArea?: string; priceWeek?: string; seriesId?: string; source?: string; estimateCents?: number;
}
const placeLabel = (p?: { name?: string; address?: string }) => [p?.name, p?.address].filter(Boolean).join(", ");
const warnBox = "grid gap-2 rounded-xl p-4";
const warnStyle = { background: "var(--unfinished)", color: "var(--unfinished-text)" } as const;
const firstName = (n: string) => n.split(" ")[0] || n;

/**
 * The gas form's state, shared so the member expense page can use it later: who drove, From (their saved home, never shown
 * as an address, or a typed address), To (the rehearsal's location, or an address; a show's venue text is looked up and the
 * first suggestion picked), MPG, round trip, and the estimate (expenses.estimateGas, re-run 300 ms after the inputs settle).
 * `good` is the estimate once nothing is missing; `payload()` is what expenses.add takes on top of amount/what/projectId.
 */
export function useGas(o: { active: boolean; drivers: readonly Row<User>[]; defaultDriver?: string; rehearsalId?: string; venueText?: string }) {
  const me = useProfile();
  const est = useCommand();
  const estCall = useRef(est.call); estCall.current = est.call;
  const [pick, setPick] = useState(o.defaultDriver ?? "");
  const driverId = pick || (o.drivers.some((u) => u.id === me.uid) ? me.uid : "");
  const driver = o.drivers.find((u) => u.id === driverId);
  const driverName = driver ? firstName(driver.name) : "";
  const forOther = !!driverId && driverId !== me.uid;
  const isAdmin = me.role === "admin";
  const reh = useDoc<Rehearsal>("rehearsals", o.rehearsalId || "none");
  const rehLoc = o.rehearsalId ? reh.doc?.location : undefined;
  const rehHasLoc = !!(rehLoc && (rehLoc.address || rehLoc.lat !== undefined));

  const [fromPick, setFromPick] = useState<Place | null>(null);
  const [fromText, setFromText] = useState("");
  const [toPick, setToPick] = useState<Place | null>(null);
  const [toText, setToText] = useState(o.venueText ?? "");
  const [roundTrip, setRoundTrip] = useState(true);
  const [mpgText, setMpgText] = useState("");
  const [saveHome, setSaveHome] = useState(true);
  const [saveMpg, setSaveMpg] = useState(true);
  const [setRehearsal, setSetRehearsal] = useState(true);
  const [need, setNeed] = useState({ mpg: false, home: false, dest: false });
  const [last, setLast] = useState<{ key: string; r: Estimate } | null>(null);
  const mpgNum = Number(mpgText);
  const mpgTyped = mpgText.trim() !== "" && mpgNum > 0;

  // A show's venue: look its text up once and take the first suggestion (the admin can retype).
  const looked = useRef("");
  useEffect(() => {
    if (!o.active || !o.venueText || looked.current === o.venueText) return;
    looked.current = o.venueText;
    setToText((t) => t || o.venueText!);
    runCommand<{ suggestions: Place[] }>("geo.autocomplete", { q: o.venueText }).then((r) => {
      const p = r.suggestions?.[0];
      if (p) { setToPick((c) => c ?? p); setToText((t) => (t === o.venueText ? placeLabel(p) : t)); }
    }).catch(() => {});
  }, [o.active, o.venueText]);

  function setDriver(id: string) {
    setPick(id); setNeed({ mpg: false, home: false, dest: false }); setLast(null); setMpgText(""); setFromPick(null); setFromText("");
  }

  const input = {
    ...(forOther ? { forId: driverId } : {}),
    ...(fromPick ? { from: { address: fromPick.address, lat: fromPick.lat, lng: fromPick.lng } } : {}),
    ...(toPick ? { to: toPick } : {}),
    ...(o.rehearsalId ? { rehearsalId: o.rehearsalId } : {}),
    ...(mpgTyped ? { mpg: mpgNum } : {}),
    roundTrip,
  };
  const key = JSON.stringify(input);
  const on = o.active && !!driverId;
  useEffect(() => {
    if (!on) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await estCall.current<Estimate>("expenses.estimateGas", JSON.parse(key));
      if (!live || !r) return;
      setLast({ key, r });
      setNeed((n) => ({ mpg: n.mpg || r.missing.includes("mpg"), home: n.home || r.missing.includes("home"), dest: n.dest || r.missing.includes("destination") }));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [key, on]);
  const cur = on && last?.key === key ? last.r : null;
  const missing = cur?.missing ?? [];
  const good = cur && cur.missing.length === 0 && cur.estimateCents && cur.miles && cur.oneWayMiles && cur.mpg && cur.priceMilli && cur.priceArea && cur.priceWeek && cur.seriesId && cur.grade ? cur : null;

  const showMpgBox = need.mpg || missing.includes("mpg") || mpgTyped;
  const showHomeBox = need.home || missing.includes("home");
  const showToBox = o.rehearsalId ? !rehHasLoc : true;

  /** The gas bits for expenses.add (the same shape the member page builds); empty until the estimate is complete. */
  function payload(cents: number) {
    const toOut = toPick ?? (rehLoc ? { name: rehLoc.name, address: rehLoc.address, lat: rehLoc.lat, lng: rehLoc.lng } : {});
    const gas = good && cents > 0 ? {
      fromKind: good.fromKind, ...(good.fromKind === "typed" && fromPick ? { fromText: fromPick.address } : {}),
      to: toOut, oneWayMiles: good.oneWayMiles!, roundTrip: good.roundTrip, miles: good.miles!, mpg: good.mpg!, grade: good.grade!,
      priceMilli: good.priceMilli!, priceArea: good.priceArea!, priceWeek: good.priceWeek!, seriesId: good.seriesId!, estimateCents: good.estimateCents!,
    } : undefined;
    return {
      ...(gas ? { gas } : {}),
      ...(gas && showMpgBox && mpgTyped && saveMpg ? { saveMpg: true } : {}),
      ...(gas && showHomeBox && fromPick && saveHome ? { saveAsHome: { ...(fromPick.name ? { name: fromPick.name } : {}), address: fromPick.address, lat: fromPick.lat, lng: fromPick.lng } } : {}),
      ...(gas && isAdmin && o.rehearsalId && !rehHasLoc && toPick && setRehearsal ? { setAsRehearsalLocation: { ...(toPick.name ? { name: toPick.name } : {}), address: toPick.address, lat: toPick.lat, lng: toPick.lng } } : {}),
    };
  }
  return {
    ...o, driverId, driverName, setDriver, forOther, isAdmin, est, cur, good, missing, rehLoc, rehHasLoc, showMpgBox, showHomeBox, showToBox, payload,
    fromPick, fromText, setFromPick, setFromText, toPick, toText, setToPick, setToText, roundTrip, setRoundTrip, mpgText, setMpgText,
    saveHome, setSaveHome, saveMpg, setSaveMpg, setRehearsal, setSetRehearsal,
  };
}
export type Gas = ReturnType<typeof useGas>;

/** The pre-fill for Amount: the estimate in dollars, or "" until it is complete. */
export const gasAmount = (g: Gas) => (g.good ? (g.good.estimateCents! / 100).toFixed(2) : "");

/** Who drove, From, To, Round trip, MPG and the estimate line. Amount and What for stay with the caller. */
export function GasFields({ g, testid, you, hideDriver, hideSetRehearsal }: {
  g: Gas; testid: string;
  /** The member page: the driver is the signed-in person, so the copy says "your" ("From your home"). */
  you?: boolean;
  /** No "Who drove" picker (the driver is fixed by the caller). */
  hideDriver?: boolean;
  /** No "Also set this as the rehearsal location" (admins only on the server). */
  hideSetRehearsal?: boolean;
}) {
  const who = you ? "you" : g.driverName || "the driver";
  const poss = you ? "your" : g.driverName ? `${g.driverName}'s` : "their";
  const miles = g.good?.miles ?? g.cur?.miles;
  const oneWay = g.cur?.oneWayMiles;
  const rehName = g.rehLoc?.name || g.rehLoc?.address;
  const estimate = oneWay === undefined ? (g.missing.includes("home") ? "needs a start address" : g.missing.includes("destination") ? "needs a destination" : g.est.busy ? "working it out" : "")
    : `${g.roundTrip ? `${oneWay} mi × 2 = ${miles} mi` : `${oneWay} mi one way`}${g.cur?.mpg ? ` · ${g.cur.mpg} mpg` : ""}${g.cur?.priceMilli ? ` · $${(g.cur.priceMilli / 1000).toFixed(2)}/gal${g.cur.priceArea ? ` ${g.cur.priceArea}` : ""}` : ""}`;
  return (
    <>
      {!hideDriver && <label className="grid gap-1">
        <span className="lbl">Who drove</span>
        <select className="select" value={g.driverId} onChange={(e) => g.setDriver(e.target.value)} data-testid={`${testid}-driver`}>
          <option value="">Pick a bandmate</option>
          {g.drivers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>}
      {g.driverId && (g.showHomeBox ? (
        <div className={warnBox} style={warnStyle}>
          <span className="lbl" style={{ color: "inherit" }}>From: where did {who} start?</span>
          <AddressAutocomplete value={g.fromText} placeholder="Start typing an address…" testId={`${testid}-from`}
            onPick={(p) => { g.setFromPick(p); g.setFromText(placeLabel(p)); }} onChange={(t) => { g.setFromText(t); if (g.fromPick) g.setFromPick(null); }} />
          <span className="s" style={{ color: "inherit" }}>{you ? "You haven't saved a home address." : `${who} hasn't saved a home address.`}</span>
          <label className="flex items-center gap-2"><input type="checkbox" checked={g.saveHome} onChange={(e) => g.setSaveHome(e.target.checked)} data-testid={`${testid}-save-home`} /><span>{you ? "Save as my home" : `Save as ${poss} home`}</span></label>
        </div>
      ) : (
        <div className="grid gap-1">
          <span className="lbl">From</span>
          <span data-testid={`${testid}-from-home`}>{poss.charAt(0).toUpperCase() + poss.slice(1)} home</span>
        </div>
      ))}
      {g.showToBox ? (
        <div className={g.rehearsalId ? warnBox : "grid gap-1"} style={g.rehearsalId ? warnStyle : undefined}>
          <span className="lbl" style={g.rehearsalId ? { color: "inherit" } : undefined}>{g.rehearsalId ? "To: where was rehearsal?" : "To"}</span>
          <AddressAutocomplete value={g.toText} placeholder="Start typing an address or place…" testId={`${testid}-to`}
            onPick={(p) => { g.setToPick(p); g.setToText(placeLabel(p)); }} onChange={(t) => { g.setToText(t); if (g.toPick) g.setToPick(null); }} />
          {g.rehearsalId && <span className="s" style={{ color: "inherit" }}>This rehearsal doesn't have a location yet.</span>}
          {g.rehearsalId && g.isAdmin && !hideSetRehearsal && <label className="flex items-center gap-2"><input type="checkbox" checked={g.setRehearsal} onChange={(e) => g.setSetRehearsal(e.target.checked)} data-testid={`${testid}-set-rehearsal-location`} /><span>Also set this as the rehearsal location</span></label>}
        </div>
      ) : (
        <div className="grid gap-1">
          <span className="lbl">To</span>
          <span data-testid={`${testid}-to-rehearsal`}>{rehName || "The rehearsal location"}</span>
        </div>
      )}
      <button type="button" role="switch" aria-checked={g.roundTrip} onClick={() => g.setRoundTrip(!g.roundTrip)} data-testid={`${testid}-roundtrip`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-0 bg-transparent p-0 text-left" style={{ font: "inherit", color: "var(--ink)" }}>
        <span>Round trip <span className="s">doubles the distance</span></span>
        <span aria-hidden className="inline-flex items-center rounded-full p-[3px]" style={{ width: 44, height: 26, background: g.roundTrip ? "var(--accent)" : "var(--input-border)", justifyContent: g.roundTrip ? "flex-end" : "flex-start" }}>
          <span className="block rounded-full" style={{ width: 20, height: 20, background: "#fff" }} />
        </span>
      </button>
      {g.driverId && g.showMpgBox && (
        <div className={warnBox} style={warnStyle}>
          {g.missing.includes("mpg") && <b>We need {poss} MPG to estimate this</b>}
          <label className="grid gap-1"><span className="lbl" style={{ color: "inherit" }}>Miles per gallon</span>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="e.g. 28" value={g.mpgText} onChange={(e) => g.setMpgText(e.target.value)} data-testid={`${testid}-mpg`} />
              <a href="https://www.fueleconomy.gov/feg/findacar.shtml" target="_blank" rel="noreferrer">Look up the car's MPG</a>
            </div></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={g.saveMpg} onChange={(e) => g.setSaveMpg(e.target.checked)} data-testid={`${testid}-save-mpg`} /><span>{you ? "Save as my MPG" : `Save as ${poss} MPG`}</span></label>
        </div>
      )}
      <div className="s" aria-live="polite" data-testid={`${testid}-estimate`}>
        {estimate || "The estimate appears once From and To are set"}{g.good ? ` · ${formatCents(g.good.estimateCents!)}` : ""}
      </div>
      <ErrorBox error={g.est.error} />
    </>
  );
}
