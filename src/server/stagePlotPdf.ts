/**
 * The stage plot PDF, made on request and never stored: the drawing is the same StagePlotSvg (forPaper, rendered to a string) placed
 * with svg-to-pdfkit, and the sheet's tables are drawn with pdfkit text. One page, Letter or A4. Font: Helvetica (pdfkit's built-in);
 * Figtree is loaded from Google at build time by next/font and no TTF is available on the server, so the PDF uses Helvetica.
 */
import { createElement } from "react";
import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { StagePlotSvg } from "@/components/stagePlots/StagePlotSvg";
import { viewBoxOf } from "@/lib/stagePlots/plot";
import { PAPER_PT, channelRows, mixRows, sheetDate, type Paper, type SheetPlot } from "@/lib/stagePlots/sheet";

// Next's app-route bundles refuse a static import of react-dom/server (it is meant for components). This is a plain server route
// turning the same SVG component into a string, so load it at runtime from node_modules, outside the bundler.
const { renderToStaticMarkup } = createRequire(`${process.cwd()}/package.json`)("react-dom/server") as typeof import("react-dom/server");

const INK = "#111111", GREY = "#555555", RULE = "#DDDDDD";
const MX = 32, MY = 30;
const REG = "Helvetica", BOLD = "Helvetica-Bold", ITAL = "Helvetica-Oblique";

export interface PdfInput { plot: SheetPlot; artist: string; lineupName?: string; names?: Record<string, string>; paper?: Paper; date?: Date }

export function plotFileName(plot: { name?: string; version?: number }) {
  const slug = (plot.name ?? "stage-plot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stage-plot";
  return `${slug}-v${plot.version ?? 1}.pdf`;
}

export function buildStagePlotPdf({ plot, artist, lineupName, names = {}, paper = "letter", date = new Date() }: PdfInput): Promise<Buffer> {
  const { w, h } = PAPER_PT[paper];
  const cw = w - 2 * MX;
  const doc = new PDFDocument({ size: [w, h], margin: 0, info: { Title: `${artist} stage plot${plot.name ? ` - ${plot.name}` : ""}`, Author: artist } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const ch = channelRows(plot, names), mx = mixRows(plot, names);
  const bn = ([["We bring", plot.bring], ["We need", plot.need]] as const).filter(([, v]) => v);
  const colW = (cw - 12) / 2;
  doc.font(REG).fontSize(8.5);
  const bnH = bn.length ? 14 + Math.min(70, Math.max(...bn.map(([, v]) => doc.heightOfString(v!, { width: colW })))) : 0;

  // Vertical budget: header, plot, tables, bring/need. Shrink the plot, then the rows, until it fits one page.
  const HEADER = 40, GAP = 8;
  const rowsN = (ch.length ? ch.length + 1 : 0) + (mx.length ? mx.length + 1 : 0);
  const gaps = GAP * (1 + (ch.length ? 1 : 0) + (mx.length ? 1 : 0) + (bn.length ? 1 : 0));
  const avail = h - 2 * MY - HEADER - bnH - gaps;
  const vb = viewBoxOf(plot.stage);
  const plotMax = Math.min(300, (cw * vb.h) / vb.w);
  let rh = 13;
  let plotH = Math.min(plotMax, avail - rowsN * rh);
  if (plotH < 150) { plotH = Math.min(150, plotMax); rh = Math.max(6, Math.min(13, (avail - plotH) / Math.max(1, rowsN))); }
  if (rowsN * rh + plotH > avail) plotH = Math.max(60, avail - rowsN * rh);
  const fs = Math.min(9, rh * 0.7);

  // header
  let y = MY;
  doc.font(BOLD).fontSize(17).fillColor(INK).text(artist, MX, y, { lineBreak: false, width: cw - 110 });
  doc.font(BOLD).fontSize(10.5).text(`Stage plot${plot.name ? ` · ${plot.name}` : ""}${lineupName ? ` · ${lineupName}` : ""}`, MX, y + 20, { lineBreak: false, width: cw - 110 });
  doc.font(REG).fontSize(10).text(`v${plot.version ?? 1} · ${sheetDate(date)}`, MX + cw - 110, y + 4, { width: 110, align: "right", lineBreak: false });
  doc.moveTo(MX, y + HEADER - 6).lineTo(MX + cw, y + HEADER - 6).lineWidth(1.5).strokeColor(INK).stroke();
  y += HEADER + GAP;

  // the drawing, scaled to fit its box and centred
  const scale = Math.min(cw / vb.w, plotH / vb.h);
  const pw = vb.w * scale, ph = vb.h * scale;
  let svg = renderToStaticMarkup(createElement(StagePlotSvg, { plot, forPaper: true }));
  svg = svg.replace(/^<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${pw}" height="${ph}"`);
  SVGtoPDF(doc, svg, MX + (cw - pw) / 2, y, {
    width: pw, height: ph, assumePt: true, preserveAspectRatio: "xMidYMid meet",
    warningCallback: () => {},
    fontCallback: (_family, bold, italic) => (bold ? BOLD : italic ? ITAL : REG),
  });
  y += ph + GAP;

  const cell = (text: string, x: number, width: number, opts: { bold?: boolean; grey?: boolean } = {}) =>
    doc.font(opts.bold ? BOLD : REG).fontSize(fs).fillColor(opts.grey ? GREY : INK).text(text, x + 2, y + (rh - fs) / 2 - 0.5, { width: width - 4, lineBreak: false, ellipsis: true, height: rh });
  const table = (cols: [string, number][], rows: { cells: string[]; note?: string }[]) => {
    const total = cols.reduce((a, [, f]) => a + f, 0);
    const xs: number[] = [], ws = cols.map(([, f]) => (f / total) * cw);
    ws.reduce((x, wd) => (xs.push(x), x + wd), MX);
    doc.font(BOLD).fontSize(Math.min(7.5, fs));
    cols.forEach(([t], i) => { doc.fillColor(INK).text(t.toUpperCase(), xs[i] + 2, y + (rh - 7) / 2, { width: ws[i] - 4, lineBreak: false }); });
    y += rh;
    doc.moveTo(MX, y).lineTo(MX + cw, y).lineWidth(1).strokeColor(INK).stroke();
    for (const r of rows) {
      r.cells.forEach((t, i) => {
        if (i === 1 && r.note) {
          const tag = r.note, tw = doc.font(ITAL).fontSize(fs).widthOfString(tag) + 4;
          cell(t, xs[i], ws[i] - tw);
          doc.font(ITAL).fontSize(fs).fillColor(GREY).text(tag, xs[i] + ws[i] - tw, y + (rh - fs) / 2 - 0.5, { width: tw, lineBreak: false });
        } else cell(t, xs[i], ws[i], { bold: i === 0 });
      });
      y += rh;
      doc.moveTo(MX, y).lineTo(MX + cw, y).lineWidth(0.5).strokeColor(RULE).stroke();
    }
    y += GAP;
  };

  if (ch.length) table([["Ch", 24], ["Source", 120], ["Mic / DI", 90], ["Stand", 70], ["48V", 30], ["Who", 70], ["Note", 130]],
    ch.map((r) => ({ cells: [String(r.n), r.source || "-", r.gear, r.stand, r.phantom ? "48V" : "", r.who, r.note], note: r.placed ? undefined : "not placed" })));
  if (mx.length) table([["Mix", 30], ["Type", 90], ["Who", 100], ["Wants", 280]],
    mx.map((r) => ({ cells: [`M${r.n}`, r.kind, r.who, r.wants], note: r.placed ? undefined : "not placed" })));

  if (bn.length) {
    bn.forEach(([title, text], i) => {
      const x = MX + i * (colW + 12);
      doc.font(BOLD).fontSize(7.5).fillColor(INK).text(title.toUpperCase(), x, y, { width: colW, lineBreak: false });
      doc.moveTo(x, y + 11).lineTo(x + colW, y + 11).lineWidth(1).strokeColor(INK).stroke();
      doc.font(REG).fontSize(8.5).fillColor(INK).text(text!, x, y + 14, { width: colW, height: bnH - 14 });
    });
  }
  doc.end();
  return done;
}
