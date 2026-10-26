"use client";
import { useState } from "react";

const money = (n: number) => "$" + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2));

/** The landing page's cost-share example: a bill split across artists, charged every few months with card fees (2.9% + 30¢). */
export function CostShareCalc() {
  const [bill, setBill] = useState(180);
  const [artists, setArtists] = useState(120);
  const [months, setMonths] = useState(6);
  const per = bill / artists, charge = per * months, total = charge + charge * 0.029 + 0.30;
  return (
    <div className="calc" aria-label="Cost share calculator">
      <p className="mono" style={{ color: "#b7b3a9" }}>Cost share math · example numbers</p>
      <label htmlFor="bill"><span>Monthly cloud bill <output>{money(bill)}</output></span>
        <input id="bill" type="range" min={20} max={2000} step={10} value={bill} onChange={(e) => setBill(+e.target.value)} /></label>
      <label htmlFor="artists"><span>Active artists <output>{artists.toLocaleString()}</output></span>
        <input id="artists" type="range" min={10} max={5000} step={10} value={artists} onChange={(e) => setArtists(+e.target.value)} /></label>
      <label htmlFor="months"><span>Billed every <output>{months} months</output></span>
        <input id="months" type="range" min={3} max={12} step={3} value={months} onChange={(e) => setMonths(+e.target.value)} /></label>
      <div className="res" aria-live="polite">
        <span className="big">{money(per)} a month</span>
        <span className="sub">{money(total)} every {months} months, including card fees</span>
      </div>
    </div>
  );
}
