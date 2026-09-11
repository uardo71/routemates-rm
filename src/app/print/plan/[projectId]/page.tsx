import { notFound } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { phaseProgress } from "@/lib/delivery";
import type { PlanTaskStatus } from "@prisma/client";
import { AutoPrint } from "./auto-print";

const DAY = 86_400_000;
const STATUS_HEX: Record<PlanTaskStatus, string> = { NOT_STARTED: "#94a3b8", IN_PROGRESS: "#3b6ea8", COMPLETED: "#2f8f5b", BLOCKED: "#b4462f" };
const STATUS_LABEL: Record<PlanTaskStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: Date | null) => (d ? format(d, "dd MMM") : "—");

export default async function PlanPrintPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ eng?: string }> }) {
  const { projectId } = await params;
  const { eng } = await searchParams;
  const user = await requireUser();
  if (!(await canManageProject(user, projectId))) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    include: {
      client: { select: { name: true } },
      manager: { select: { name: true } },
      company: { select: { name: true } },
      engagements: { select: { id: true, name: true } },
      planTasks: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!project) notFound();

  const selEng = project.engagements.some((e) => e.id === eng) ? (eng as string) : null;
  const tasks = project.planTasks.filter((t) => (t.engagementId ?? null) === selEng);
  const engName = project.engagements.find((e) => e.id === selEng)?.name ?? null;
  const heading = engName ? `${engName} — ${project.name}` : project.name;

  // group into phases (preserve order)
  const phases = [...new Set(tasks.map((t) => t.phase ?? "General"))];
  type Flat = { kind: "phase"; label: string; wbs: string; s: number; e: number; progress: number } | { kind: "task"; wbs: string; t: (typeof tasks)[number] };
  const flat: Flat[] = [];
  const dnum = (d: Date | null) => (d ? d.getTime() : NaN);
  phases.forEach((ph, pi) => {
    const g = tasks.filter((t) => (t.phase ?? "General") === ph);
    const ss = g.map((t) => dnum(t.startDate)).filter((n) => !Number.isNaN(n));
    const ee = g.map((t) => dnum(t.dueDate ?? t.startDate)).filter((n) => !Number.isNaN(n));
    const progress = phaseProgress(g.map((t) => ({ ...t, estimatedHours: t.estimatedHours == null ? null : Number(t.estimatedHours) })));
    flat.push({ kind: "phase", label: ph, wbs: String(pi + 1), s: ss.length ? Math.min(...ss) : NaN, e: ee.length ? Math.max(...ee) : NaN, progress });
    g.forEach((t, ti) => flat.push({ kind: "task", wbs: `${pi + 1}.${ti + 1}`, t }));
  });

  const times = tasks.flatMap((t) => [dnum(t.startDate), dnum(t.dueDate)]).filter((n) => !Number.isNaN(n));
  const hasTL = times.length > 0;
  // Snap to whole months so nothing sits on the edge and the month headers align.
  const a0 = hasTL ? new Date(Math.min(...times)) : new Date(); a0.setUTCDate(1); a0.setUTCHours(0, 0, 0, 0);
  const b0 = hasTL ? new Date(Math.max(...times)) : new Date(); b0.setUTCMonth(b0.getUTCMonth() + 1, 1); b0.setUTCHours(0, 0, 0, 0);
  const min = hasTL ? a0.getTime() : 0;
  const max = hasTL ? b0.getTime() : 0;
  const totalDays = Math.max(1, Math.ceil((max - min) / DAY));
  // Fixed layout sized to fit one A4 landscape page (printable ≈ 1000px at default Chrome scale).
  const PAGE_W = 940;
  const LEFT_W = 248;
  const LABEL_PAD = 60; // room for the rightmost date label so it isn't clipped
  const TL_W = PAGE_W - LEFT_W - LABEL_PAD;
  const dayW = TL_W / totalDays;
  const totalW = TL_W;
  const xOf = (ms: number) => ((ms - min) / DAY) * dayW;
  const ROW = 22;

  const months: { label: string; x: number }[] = [];
  if (hasTL) {
    const d = new Date(min); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    let g = 0;
    while (d.getTime() <= max && g++ < 60) { months.push({ label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, x: xOf(d.getTime()) }); d.setUTCMonth(d.getUTCMonth() + 1); }
  }

  return (
    <div style={{ background: "#fff", color: "#141F2B", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", padding: "24px 28px", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .g-row:nth-child(even) { background: #fafbfc; }
      `}</style>
      <AutoPrint />

      {/* header */}
      <div style={{ borderBottom: "2px solid #A9812F", paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#A9812F", fontWeight: 700, textTransform: "uppercase" }}>{project.client.name} · Project Plan</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{heading}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
          {project.number ? `${project.number} · ` : ""}PM {project.manager?.name ?? "—"} · {project.company?.name ?? "Professional Services"} · Generated {format(new Date(), "dd MMM yyyy")}
        </div>
      </div>

      {tasks.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No project plan has been built yet.</p>
      ) : (
        <div style={{ display: "flex", width: PAGE_W, border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden", fontSize: 11 }}>
          {/* left */}
          <div style={{ flexShrink: 0, borderRight: "1px solid #e5e7eb", width: LEFT_W }}>
            <div style={{ display: "grid", gridTemplateColumns: "26px 1fr 52px 52px", height: 26, alignItems: "center", background: "#141F2B", color: "#fff", fontSize: 9, fontWeight: 600 }}>
              <div style={{ paddingLeft: 6 }}>#</div><div>Task</div><div>Start</div><div>Due</div>
            </div>
            {flat.map((r, i) => r.kind === "phase" ? (
              <div key={`p${i}`} className="g-row" style={{ display: "grid", gridTemplateColumns: "26px 1fr", height: ROW, alignItems: "center", background: "#eef1f3", fontWeight: 700, borderTop: "1px solid #e5e7eb" }}>
                <div style={{ paddingLeft: 6, color: "#6b7280", fontSize: 9 }}>{r.wbs}</div><div>{r.label}</div>
              </div>
            ) : (
              <div key={r.t.id} className="g-row" style={{ display: "grid", gridTemplateColumns: "26px 1fr 52px 52px", height: ROW, alignItems: "center", borderTop: "1px solid #f0f1f3" }}>
                <div style={{ paddingLeft: 6, color: "#9ca3af", fontSize: 9 }}>{r.wbs}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 12, paddingRight: 4, fontWeight: r.t.isMilestone ? 600 : 400 }}>{r.t.isMilestone ? "◆ " : ""}{r.t.name}</div>
                <div style={{ color: "#6b7280", fontSize: 9 }}>{fmt(r.t.startDate)}</div>
                <div style={{ color: "#6b7280", fontSize: 9 }}>{fmt(r.t.dueDate)}</div>
              </div>
            ))}
          </div>
          {/* timeline */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ position: "relative", width: totalW }}>
              <div style={{ position: "relative", height: 26, background: "#141F2B" }}>
                {months.map((m, i) => <div key={i} style={{ position: "absolute", top: 0, height: "100%", left: m.x, borderLeft: "1px solid rgba(255,255,255,.15)", paddingLeft: 3, fontSize: 8, color: "#c9d1d9", display: "flex", alignItems: "center" }}>{m.label}</div>)}
              </div>
              {flat.map((r, i) => (
                <div key={r.kind === "phase" ? `pb${i}` : r.t.id} className="g-row" style={{ position: "relative", height: ROW, borderTop: r.kind === "phase" ? "1px solid #e5e7eb" : "1px solid #f0f1f3", background: r.kind === "phase" ? "#eef1f3" : undefined }}>
                  {months.map((m, k) => <div key={k} style={{ position: "absolute", top: 0, height: "100%", left: m.x, borderLeft: "1px solid #eef1f3" }} />)}
                  {r.kind === "phase"
                    ? (!Number.isNaN(r.s) && !Number.isNaN(r.e) && (
                        <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: xOf(r.s), width: Math.max(dayW, xOf(r.e) - xOf(r.s) + dayW), height: 6, background: "#e6eaee", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${r.progress}%`, background: r.progress >= 100 ? "#2f8f5b" : r.progress <= 0 ? "#94a3b8" : "#3b6ea8" }} />
                        </div>
                      ))
                    : (() => {
                        const s = r.t.startDate?.getTime(); const e = (r.t.dueDate ?? r.t.startDate)?.getTime();
                        if (r.t.isMilestone && e != null) return (
                          <div style={{ position: "absolute", top: "50%", left: xOf(e) + dayW / 2 - 5, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 9, height: 9, background: "#A9812F", transform: "rotate(45deg)", display: "inline-block", flexShrink: 0 }} />
                            <span style={{ fontSize: 8, color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(r.t.dueDate ?? r.t.startDate)}</span>
                          </div>
                        );
                        if (s != null && e != null) {
                          const bx = xOf(s); const bw = Math.max(3, xOf(e) - bx + dayW);
                          const derived = r.t.progress >= 100 ? "COMPLETED" : r.t.progress <= 0 ? "NOT_STARTED" : r.t.status === "BLOCKED" ? "BLOCKED" : "IN_PROGRESS";
                          return (
                            <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: bx, display: "flex", alignItems: "center", gap: 4 }}>
                              <div style={{ width: bw, height: 10, background: "#e6eaee", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                                <div style={{ height: "100%", width: `${r.t.progress}%`, background: STATUS_HEX[derived as PlanTaskStatus] }} />
                              </div>
                              <span style={{ fontSize: 8, color: "#9ca3af", whiteSpace: "nowrap" }}>{fmt(r.t.dueDate)}</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 9, color: "#6b7280" }}>
        {(Object.keys(STATUS_LABEL) as PlanTaskStatus[]).map((st) => (
          <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: STATUS_HEX[st], borderRadius: 2, display: "inline-block" }} /> {STATUS_LABEL[st]}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, background: "#A9812F", transform: "rotate(45deg)", display: "inline-block" }} /> Milestone</span>
      </div>
    </div>
  );
}
