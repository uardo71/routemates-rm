import pptxgen from "pptxgenjs";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, canManageProject } from "@/lib/permissions";
import { SEVERITY_LABEL, RAG_DIMENSIONS, RAG_DIMENSION_LABEL, RAG_LABEL, phaseProgress, paginate } from "@/lib/delivery";
import type { RagStatus, PlanTaskStatus } from "@prisma/client";

const fmt = (d: Date | null) => (d ? format(d, "dd MMM yyyy") : "—");
const fmtShort = (d: Date | null) => (d ? format(d, "dd MMM") : "—");

// Brass & paper palette — matches the app so the deck feels of a piece.
const INK = "141F2B";
const BRASS = "A9812F";
const PAPER = "EBEFF1";
const LINE = "D9DEE2";
const MUTE = "6B7280";
const WHITE = "FFFFFF";
const SEV_HEX: Record<RagStatus, string> = { GREEN: "2F8F5B", AMBER: "BD8420", RED: "B4462F" };
const STATUS_HEX: Record<PlanTaskStatus, string> = { NOT_STARTED: "94A3B8", IN_PROGRESS: "3B6EA8", COMPLETED: "2F8F5B", BLOCKED: "B4462F" };
// Progress drives the status shown (0 = not started, 100 = completed), preserving a manual BLOCKED.
const deriveStatus = (pr: number, cur: PlanTaskStatus): PlanTaskStatus => cur === "BLOCKED" ? "BLOCKED" : pr >= 100 ? "COMPLETED" : pr <= 0 ? "NOT_STARTED" : "IN_PROGRESS";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "delivery:manage")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const report = await prisma.statusReport.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      author: { select: { name: true } },
      actions: { orderBy: { sortOrder: "asc" } },
      engagement: { select: { name: true } },
      project: {
        select: {
          id: true, name: true, number: true,
          client: { select: { name: true } },
          manager: { select: { name: true } },
          company: { select: { name: true } },
          planTasks: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await canManageProject(user, report.project.id))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const p = { ...report.project, planTasks: report.project.planTasks.filter((t) => (t.engagementId ?? null) === (report.engagementId ?? null)) };
  const endCustomer = report.engagement?.name ?? p.client.name;
  const provider = p.company?.name ?? "Professional Services";
  const pct = report.progressPercent ?? 0;

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pptx.defineLayout({ name: "W", width: 13.33, height: 7.5 });

  const footer = (s: pptxgen.Slide, n: number) => {
    s.addShape("line", { x: 0.6, y: 7.05, w: 12.13, h: 0, line: { color: LINE, width: 0.75 } });
    s.addText([
      { text: `${p.name}`, options: { color: MUTE } },
      { text: `   ·   ${fmt(report.reportDate)}   ·   Confidential`, options: { color: MUTE } },
    ], { x: 0.6, y: 7.1, w: 10, h: 0.3, fontSize: 8, align: "left", valign: "middle" });
    s.addText(String(n), { x: 12.3, y: 7.1, w: 0.4, h: 0.3, fontSize: 8, color: MUTE, align: "right", valign: "middle" });
  };
  const sectionTitle = (s: pptxgen.Slide, title: string) => {
    s.addShape("rect", { x: 0.6, y: 0.55, w: 0.11, h: 0.5, fill: { color: BRASS } });
    s.addText(title, { x: 0.85, y: 0.5, w: 11, h: 0.6, fontSize: 24, bold: true, color: INK, valign: "middle" });
  };

  // ---------------- Slide 1 — Title ----------------
  const s1 = pptx.addSlide();
  s1.background = { color: INK };
  s1.addShape("rect", { x: 0, y: 3.4, w: 1.4, h: 0.08, fill: { color: BRASS } });
  s1.addText(endCustomer.toUpperCase(), { x: 0.9, y: 1.5, w: 11.5, fontSize: 14, color: "C9B27A", bold: true, charSpacing: 2 });
  s1.addText("Project Status Update", { x: 0.85, y: 2.2, w: 11.6, fontSize: 40, bold: true, color: WHITE });
  s1.addText(p.name, { x: 0.9, y: 3.7, w: 11.5, fontSize: 20, color: "AEB9C4" });
  s1.addText([
    { text: `${fmt(report.reportDate)}`, options: { color: WHITE, bold: true } },
    { text: p.number ? `    ·    ${p.number}` : "", options: { color: "8B95A0" } },
    { text: `    ·    PM ${p.manager?.name ?? report.author.name}`, options: { color: "8B95A0" } },
  ], { x: 0.9, y: 5.1, w: 11.5, fontSize: 14 });
  s1.addText(`${provider}  ·  Professional Services`, { x: 0.9, y: 6.7, w: 11.5, fontSize: 11, color: "6B7783" });

  // ---------------- Slide 2 — Project Status ----------------
  const s2 = pptx.addSlide();
  sectionTitle(s2, "Project Status");

  // top strip: three stat cards (Progress / Severity / Period)
  const cardY = 1.35, cardH = 1.25;
  const card = (x: number, w: number) => s2.addShape("rect", { x, y: cardY, w, h: cardH, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
  // progress card
  card(0.6, 5.5);
  s2.addText("PROGRESS", { x: 0.8, y: cardY + 0.12, fontSize: 9, bold: true, color: MUTE, charSpacing: 1 });
  s2.addText(`${pct}%`, { x: 0.8, y: cardY + 0.32, w: 1.6, fontSize: 30, bold: true, color: INK });
  s2.addShape("roundRect", { x: 2.5, y: cardY + 0.55, w: 3.4, h: 0.16, rectRadius: 0.08, fill: { color: PAPER } });
  if (pct > 0) s2.addShape("roundRect", { x: 2.5, y: cardY + 0.55, w: Math.max(0.16, (3.4 * pct) / 100), h: 0.16, rectRadius: 0.08, fill: { color: BRASS } });
  // severity card
  card(6.3, 3.1);
  s2.addText("SEVERITY / TIMING", { x: 6.5, y: cardY + 0.12, fontSize: 9, bold: true, color: MUTE, charSpacing: 1 });
  s2.addShape("roundRect", { x: 6.5, y: cardY + 0.45, w: 2.7, h: 0.55, rectRadius: 0.06, fill: { color: SEV_HEX[report.overallRag] } });
  s2.addText(SEVERITY_LABEL[report.overallRag], { x: 6.5, y: cardY + 0.45, w: 2.7, h: 0.55, fontSize: 13, bold: true, color: WHITE, align: "center", valign: "middle" });
  // schedule / budget / scope as three small pills
  RAG_DIMENSIONS.forEach((d, i) => {
    const px = 6.5 + i * 0.92;
    s2.addShape("roundRect", { x: px, y: cardY + 1.02, w: 0.86, h: 0.18, rectRadius: 0.09, fill: { color: SEV_HEX[report[d]] } });
    s2.addText(`${RAG_DIMENSION_LABEL[d]} · ${RAG_LABEL[report[d]].split(" ")[0]}`, { x: px, y: cardY + 1.02, w: 0.86, h: 0.18, fontSize: 6.5, bold: true, color: WHITE, align: "center", valign: "middle" });
  });
  // period card
  card(9.6, 3.13);
  s2.addText("REPORTING", { x: 9.8, y: cardY + 0.12, fontSize: 9, bold: true, color: MUTE, charSpacing: 1 });
  s2.addText(report.periodStart && report.periodEnd ? `${fmtShort(report.periodStart)} – ${fmtShort(report.periodEnd)}` : fmt(report.reportDate), { x: 9.8, y: cardY + 0.38, w: 2.8, fontSize: 15, bold: true, color: INK });
  s2.addText(report.cadence ? `${report.cadence.toLowerCase()} cadence` : "", { x: 9.8, y: cardY + 0.78, w: 2.8, fontSize: 10, color: MUTE });

  // current status (left) + next actions (right)
  const bodyY = 2.95;
  // Left column: current status, then accomplishments when there are any (the status box shrinks).
  const hasAcc = !!report.accomplishments;
  const statusH = hasAcc ? 2.05 : 3.4;
  s2.addText("CURRENT STATUS", { x: 0.6, y: bodyY, fontSize: 11, bold: true, color: BRASS, charSpacing: 1 });
  s2.addShape("rect", { x: 0.6, y: bodyY + 0.35, w: 5.7, h: statusH, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
  s2.addText(report.summary || "—", { x: 0.8, y: bodyY + 0.5, w: 5.3, h: statusH - 0.3, fontSize: hasAcc ? 11 : 12, color: INK, valign: "top", lineSpacingMultiple: 1.15 });
  if (hasAcc) {
    const accY = bodyY + 0.35 + statusH + 0.25;
    s2.addText("ACCOMPLISHMENTS", { x: 0.6, y: accY - 0.32, fontSize: 11, bold: true, color: BRASS, charSpacing: 1 });
    s2.addShape("rect", { x: 0.6, y: accY, w: 5.7, h: 6.75 - accY, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
    s2.addText(report.accomplishments ?? "", { x: 0.8, y: accY + 0.1, w: 5.3, h: 6.75 - accY - 0.2, fontSize: 10.5, color: INK, valign: "top", lineSpacingMultiple: 1.1 });
  }

  s2.addText("NEXT ACTIONS", { x: 6.6, y: bodyY, fontSize: 11, bold: true, color: BRASS, charSpacing: 1 });
  if (report.actions.length) {
    const head = ["Action", "Owner", "Due", ""].map((t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: INK }, fontSize: 9, align: "left" as const } }));
    const rows = report.actions.map((a) => [
      { text: a.description, options: { fontSize: 9.5, color: INK, valign: "middle" as const } },
      { text: a.owner ?? "—", options: { fontSize: 9.5, color: MUTE, valign: "middle" as const } },
      { text: a.dueDate ? fmtShort(a.dueDate) : "—", options: { fontSize: 9.5, color: MUTE, valign: "middle" as const } },
      { text: a.critical ? "!" : "", options: { fontSize: 11, bold: true, color: WHITE, fill: { color: a.critical ? SEV_HEX.RED : WHITE }, align: "center" as const, valign: "middle" as const } },
    ]);
    s2.addTable([head, ...rows], { x: 6.6, y: bodyY + 0.35, w: 6.13, colW: [3.5, 1.4, 0.93, 0.3], border: { type: "solid", color: LINE, pt: 0.5 }, rowH: 0.32, valign: "middle" });
  } else {
    s2.addShape("rect", { x: 6.6, y: bodyY + 0.35, w: 6.13, h: 0.6, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
    s2.addText("Nothing outstanding.", { x: 6.8, y: bodyY + 0.35, w: 5.8, h: 0.6, fontSize: 10, color: MUTE, valign: "middle" });
  }

  // corrective actions strip — shares the row with "decisions needed" when the customer owes one
  const hasDec = !!report.decisionsNeeded;
  const stripW = hasDec ? 2.95 : 6.13;
  s2.addText("CORRECTIVE ACTIONS", { x: 6.6, y: 5.35, fontSize: 11, bold: true, color: BRASS, charSpacing: 1 });
  s2.addShape("rect", { x: 6.6, y: 5.7, w: stripW, h: 1.05, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
  s2.addText(report.correctiveActions || "None required.", { x: 6.8, y: 5.78, w: stripW - 0.35, h: 0.9, fontSize: 10.5, color: INK, valign: "top" });
  if (hasDec) {
    s2.addText("DECISIONS NEEDED", { x: 9.78, y: 5.35, fontSize: 11, bold: true, color: BRASS, charSpacing: 1 });
    s2.addShape("rect", { x: 9.78, y: 5.7, w: 2.95, h: 1.05, fill: { color: "FFF7E6" }, line: { color: "E4C989", width: 1 } });
    s2.addText(report.decisionsNeeded ?? "", { x: 9.95, y: 5.78, w: 2.6, h: 0.9, fontSize: 10.5, color: INK, valign: "top" });
  }
  footer(s2, 2);

  // ---------------- Slide 3+ — Project Plan (Gantt, mirrors the print PDF; paginated) ----------------
  const DAY = 86_400_000;
  const ROWS_PER_SLIDE = 30;
  const allT = p.planTasks.flatMap((t) => [t.startDate?.getTime(), t.dueDate?.getTime()]).filter((n): n is number => n != null);
  let slideNo = 3;

  const legend = (sl: pptxgen.Slide) => {
    ([["Not started", "NOT_STARTED"], ["In progress", "IN_PROGRESS"], ["Completed", "COMPLETED"], ["Blocked", "BLOCKED"]] as [string, PlanTaskStatus][]).forEach(([label, st], i) => {
      sl.addShape("rect", { x: 0.6 + i * 1.7, y: 6.9, w: 0.14, h: 0.14, fill: { color: STATUS_HEX[st] } });
      sl.addText(label, { x: 0.8 + i * 1.7, y: 6.85, w: 1.5, fontSize: 7.5, color: MUTE });
    });
    sl.addShape("diamond", { x: 0.6 + 4 * 1.7, y: 6.9, w: 0.13, h: 0.13, fill: { color: BRASS } });
    sl.addText("Milestone", { x: 0.8 + 4 * 1.7, y: 6.85, w: 1.5, fontSize: 7.5, color: MUTE });
  };

  if (allT.length === 0) {
    const s3 = pptx.addSlide();
    sectionTitle(s3, "Project Plan");
    s3.addText("No project plan has been built yet.", { x: 0.6, y: 1.6, fontSize: 13, color: MUTE });
    legend(s3);
    footer(s3, slideNo++);
  } else {
    // flat rows: phase summary (duration-weighted rollup %) + its tasks
    const phaseList = [...new Set(p.planTasks.map((t) => t.phase ?? "General"))];
    type FR = { kind: "phase"; label: string; wbs: string; s: number; e: number; progress: number } | { kind: "task"; wbs: string; t: (typeof p.planTasks)[number] };
    const flat: FR[] = [];
    phaseList.forEach((ph, pi) => {
      const g = p.planTasks.filter((t) => (t.phase ?? "General") === ph);
      const ss = g.map((t) => t.startDate?.getTime()).filter((n): n is number => n != null);
      const ee = g.map((t) => (t.dueDate ?? t.startDate)?.getTime()).filter((n): n is number => n != null);
      flat.push({ kind: "phase", label: ph, wbs: String(pi + 1), s: ss.length ? Math.min(...ss) : NaN, e: ee.length ? Math.max(...ee) : NaN, progress: phaseProgress(g) });
      g.forEach((t, ti) => flat.push({ kind: "task", wbs: `${pi + 1}.${ti + 1}`, t }));
    });

    // month-snapped window (shared by every page so the timeline reads the same across slides)
    const a = new Date(Math.min(...allT)); a.setUTCDate(1); a.setUTCHours(0, 0, 0, 0);
    const b = new Date(Math.max(...allT)); b.setUTCMonth(b.getUTCMonth() + 1, 1); b.setUTCHours(0, 0, 0, 0);
    const min = a.getTime(), max = b.getTime();
    const totalDays = Math.max(1, Math.round((max - min) / DAY));
    const months: number[] = [];
    { const d = new Date(min); let gi = 0; while (d.getTime() <= max && gi++ < 40) { months.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + 1); } }

    // layout
    const TOP = 1.35, HDR = 0.28;
    const WBSX = 0.5, NAMEX = 0.82, STARTX = 3.55, DUEX = 4.17, LEFTW = 4.27;
    const TLX = 4.95, TLW = 7.8;
    const ROWSY = TOP + HDR;
    const xOf = (ms: number) => TLX + (TLW * (ms - min)) / (totalDays * DAY);

    const pages = paginate(flat, ROWS_PER_SLIDE);
    pages.forEach((rows, pageIdx) => {
      const s3 = pptx.addSlide();
      sectionTitle(s3, pages.length > 1 ? `Project Plan (${pageIdx + 1}/${pages.length})` : "Project Plan");
      const rowH = Math.min(0.2, (6.75 - ROWSY) / Math.max(1, rows.length));

      // header band
      s3.addShape("rect", { x: WBSX, y: TOP, w: LEFTW, h: HDR, fill: { color: INK } });
      s3.addShape("rect", { x: TLX, y: TOP, w: TLW, h: HDR, fill: { color: INK } });
      ([["#", WBSX + 0.03], ["Task", NAMEX], ["Start", STARTX], ["Due", DUEX]] as [string, number][]).forEach(([t, x]) => s3.addText(t, { x, y: TOP, w: 1, h: HDR, fontSize: 8, bold: true, color: WHITE, valign: "middle" }));
      months.forEach((mm) => {
        const gxp = xOf(mm);
        s3.addText(format(new Date(mm), "MMM ''yy"), { x: gxp + 0.03, y: TOP, w: 1, h: HDR, fontSize: 7.5, color: "C9D1D9", valign: "middle" });
      });

      // row backgrounds + left text
      rows.forEach((r, i) => {
        const y = ROWSY + i * rowH;
        if (r.kind === "phase") {
          s3.addShape("rect", { x: WBSX, y, w: LEFTW, h: rowH, fill: { color: "EEF1F3" } });
          s3.addShape("rect", { x: TLX, y, w: TLW, h: rowH, fill: { color: "EEF1F3" } });
          s3.addText(r.wbs, { x: WBSX + 0.03, y, w: 0.3, h: rowH, fontSize: 7.5, color: MUTE, valign: "middle" });
          s3.addText(`${r.label}  ·  ${r.progress}%`, { x: NAMEX, y, w: 2.7, h: rowH, fontSize: 8, bold: true, color: INK, valign: "middle" });
        } else {
          const t = r.t;
          s3.addText(r.wbs, { x: WBSX + 0.03, y, w: 0.3, h: rowH, fontSize: 7, color: MUTE, valign: "middle" });
          s3.addText(`${t.isMilestone ? "◆ " : ""}${t.name}`, { x: NAMEX + 0.12, y, w: 2.55, h: rowH, fontSize: 7.5, bold: t.isMilestone, color: INK, valign: "middle" });
          s3.addText(fmtShort(t.startDate), { x: STARTX, y, w: 0.6, h: rowH, fontSize: 7, color: MUTE, valign: "middle" });
          s3.addText(fmtShort(t.dueDate ?? t.startDate), { x: DUEX, y, w: 0.6, h: rowH, fontSize: 7, color: MUTE, valign: "middle" });
        }
      });

      // gridlines over the timeline + left/timeline divider
      const gridH = rows.length * rowH;
      months.forEach((mm) => s3.addShape("line", { x: xOf(mm), y: ROWSY, w: 0, h: gridH, line: { color: "E8ECEF", width: 0.5 } }));
      s3.addShape("line", { x: TLX, y: TOP, w: 0, h: HDR + gridH, line: { color: LINE, width: 0.75 } });

      // bars / diamonds
      rows.forEach((r, i) => {
        const cy = ROWSY + i * rowH + rowH / 2;
        if (r.kind === "phase") {
          if (!Number.isNaN(r.s) && !Number.isNaN(r.e)) {
            const bx = xOf(r.s), bw = Math.max(0.06, xOf(r.e) - bx);
            s3.addShape("roundRect", { x: bx, y: cy - 0.045, w: bw, h: 0.09, rectRadius: 0.02, fill: { color: "DDE2E6" } });
            if (r.progress > 0) s3.addShape("roundRect", { x: bx, y: cy - 0.045, w: Math.max(0.03, (bw * r.progress) / 100), h: 0.09, rectRadius: 0.02, fill: { color: r.progress >= 100 ? STATUS_HEX.COMPLETED : "3B6EA8" } });
          }
        } else {
          const t = r.t;
          const s = t.startDate?.getTime(); const e = (t.dueDate ?? t.startDate)?.getTime();
          if (t.isMilestone && e != null) {
            s3.addShape("diamond", { x: xOf(e) - 0.055, y: cy - 0.055, w: 0.11, h: 0.11, fill: { color: BRASS } });
            s3.addText(fmtShort(new Date(e)), { x: xOf(e) + 0.08, y: cy - 0.09, w: 0.8, h: 0.18, fontSize: 6.5, bold: true, color: INK, valign: "middle" });
          } else if (s != null && e != null) {
            const bx = xOf(s), bw = Math.max(0.06, xOf(e) - bx);
            s3.addShape("roundRect", { x: bx, y: cy - 0.055, w: bw, h: 0.11, rectRadius: 0.02, fill: { color: "E6EAEE" } });
            if (t.progress > 0) s3.addShape("roundRect", { x: bx, y: cy - 0.055, w: Math.max(0.03, (bw * t.progress) / 100), h: 0.11, rectRadius: 0.02, fill: { color: STATUS_HEX[deriveStatus(t.progress, t.status)] } });
          }
        }
      });
      if (pageIdx < pages.length - 1) s3.addText(`continues on the next slide (${flat.length - (pageIdx + 1) * ROWS_PER_SLIDE} more rows)`, { x: WBSX, y: ROWSY + gridH + 0.05, fontSize: 7.5, italic: true, color: MUTE });
      legend(s3);
      footer(s3, slideNo++);
    });
  }

  // ---------------- Slide 4 — Thank you ----------------
  const s4 = pptx.addSlide();
  void slideNo; // the closing slide carries no number, as before
  s4.background = { color: INK };
  s4.addShape("rect", { x: 0.9, y: 3.5, w: 1.2, h: 0.08, fill: { color: BRASS } });
  s4.addText("Questions & discussion", { x: 0.85, y: 2.6, w: 11.6, fontSize: 34, bold: true, color: WHITE });
  s4.addText(`${p.manager?.name ?? report.author.name}  ·  ${provider}`, { x: 0.9, y: 3.8, w: 11.5, fontSize: 14, color: "AEB9C4" });

  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safe = (p.number ?? p.name).replace(/[^\w-]+/g, "_").slice(0, 40);
  const fileName = `${endCustomer.replace(/[^\w-]+/g, "_")}-Status-${safe}-${format(report.reportDate, "yyyy-MM-dd")}.pptx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
