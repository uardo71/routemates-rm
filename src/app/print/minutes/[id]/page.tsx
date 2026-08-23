import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { AutoPrint } from "./auto-print";

const fmt = (d: Date | null) => (d ? format(d, "dd/MM/yyyy") : "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const m = await prisma.meetingMinutes.findUnique({ where: { id }, select: { title: true } });
  return { title: m?.title ? `Meeting Minute — ${m.title}` : "Meeting Minute" };
}

const INK = "#141F2B";
const BRASS = "#A9812F";
const LINE = "#d9dee2";
const MUTE = "#6b7280";

export default async function MinutesPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const m = await prisma.meetingMinutes.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      participants: { orderBy: { sortOrder: "asc" } },
      actions: { orderBy: { sortOrder: "asc" } },
      project: { select: { id: true, name: true, company: { select: { name: true } }, client: { select: { name: true } } } },
      engagement: { select: { name: true } },
    },
  });
  if (!m) notFound();
  if (!(await canManageProject(user, m.project.id))) notFound();

  const customer = m.engagement?.name ?? null;
  // Who we present as: for an end customer of a partner (an engagement under e.g. the Tungsten
  // portfolio) we deliver under the partner's name (the project's client); for a direct customer we
  // present as our own company.
  const provider = m.engagementId ? m.project.client.name : (m.project.company?.name ?? "Professional Services");
  // Split the discussion body into bullet lines.
  const bullets = (m.notes ?? "").split(/\r?\n/).map((s) => s.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean);

  const th: React.CSSProperties = { background: INK, color: "#fff", fontSize: 10, fontWeight: 700, padding: "5px 8px", textAlign: "left", border: `1px solid ${INK}` };
  const td: React.CSSProperties = { fontSize: 10.5, padding: "5px 8px", border: `1px solid ${LINE}`, verticalAlign: "top" };
  const lblCell: React.CSSProperties = { ...td, background: "#f4f6f7", fontWeight: 700, width: 150, color: INK };

  return (
    <div style={{ background: "#fff", color: INK, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", padding: "22px 30px", maxWidth: 820, margin: "0 auto" }}>
      <style>{`@page { size: A4 portrait; margin: 14mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <AutoPrint />

      <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, letterSpacing: 3, color: INK, marginBottom: 4 }}>MEETING MINUTE</div>
      <div style={{ height: 3, background: BRASS, width: 90, margin: "0 auto 16px" }} />

      {/* header */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <tbody>
          <tr><td style={lblCell}>Meeting Title:</td><td style={td}>{m.title}</td></tr>
          <tr><td style={lblCell}>Date of the meeting:</td><td style={td}>{fmt(m.date)}</td></tr>
          <tr><td style={lblCell}>Time of the meeting:</td><td style={td}>{m.timeFrom || m.timeTo ? `${m.timeFrom ?? ""}${m.timeTo ? ` - ${m.timeTo}` : ""}` : ""}</td></tr>
          <tr><td style={lblCell}>Location of the meeting:</td><td style={td}>{m.location ?? ""}</td></tr>
          <tr><td style={lblCell}>Minute Taker:</td><td style={td}>{m.minuteTaker ?? ""}</td></tr>
          {customer && <tr><td style={lblCell}>Customer:</td><td style={td}>{customer}</td></tr>}
        </tbody>
      </table>

      {/* participants */}
      {m.participants.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
          <thead><tr><th style={th}>Name</th><th style={th}>Company</th><th style={th}>Role</th><th style={th}>Group</th></tr></thead>
          <tbody>
            {m.participants.map((p) => (
              <tr key={p.id}><td style={td}>{p.name}</td><td style={td}>{p.company ?? ""}</td><td style={td}>{p.role ?? ""}</td><td style={td}>{p.group ?? ""}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {/* agenda */}
      {(m.agendaTopic || m.agendaWho || m.agendaDuration) && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
          <thead><tr><th style={{ ...th, width: "70%" }}>Meeting Agenda</th><th style={th}>Who</th><th style={th}>Duration</th></tr></thead>
          <tbody><tr><td style={td}>{m.agendaTopic ?? ""}</td><td style={td}>{m.agendaWho ?? ""}</td><td style={td}>{m.agendaDuration ?? ""}</td></tr></tbody>
        </table>
      )}

      {/* discussion */}
      {bullets.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: BRASS, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Discussion</div>
          <ul style={{ margin: 0, paddingLeft: 20, listStyleType: "disc" }}>
            {bullets.map((b, i) => <li key={i} style={{ fontSize: 10.5, lineHeight: 1.5, marginBottom: 4 }}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* next steps */}
      {m.actions.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
          <thead><tr><th style={{ ...th, width: "62%" }}>Next Steps — To Discuss / Do</th><th style={th}>Who</th><th style={th}>Due Date</th></tr></thead>
          <tbody>
            {m.actions.map((a) => (
              <tr key={a.id}><td style={{ ...td, textDecoration: a.done ? "line-through" : "none", color: a.done ? MUTE : INK }}>{a.description}</td><td style={td}>{a.owner ?? ""}</td><td style={td}>{fmt(a.dueDate)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {/* footer */}
      <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 24, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 8.5, color: MUTE }}>
        <span>{provider}</span>
        <span>{format(new Date(), "dd MMMM yyyy")}</span>
      </div>
    </div>
  );
}
