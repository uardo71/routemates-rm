import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAlerts } from "@/lib/alerts/run";
import { authorizedInternal, flag } from "@/lib/internal-auth";

// The operational-alerts entry point. One scheduled POST a day is enough: the runner is idempotent
// per day (AppSetting marker) and per alert forever (Notification ledger), so a scheduler that
// fires more often, or a manual re-run, never double-sends. Same shared-secret gate as the nudge.
//
//   POST /api/internal/alerts?dryRun=0|1&force=0|1
//   header: x-nudge-secret: <TIMESHEET_NUDGE_SECRET>
//
// dryRun: evaluate and report, send nothing, record nothing. force: ignore the once-a-day marker
// (the ledger still applies — force can't make an alert go out twice).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const dryRun = flag(searchParams.get("dryRun"));
  const force = flag(searchParams.get("force"));

  const companies = await prisma.company.findMany({ select: { id: true } });
  const reports = [];
  for (const c of companies) reports.push(await runAlerts(c.id, { dryRun, force }));
  return NextResponse.json({ ok: true, dryRun, reports });
}
