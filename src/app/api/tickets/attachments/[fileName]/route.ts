import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { readReceiptFile } from "@/lib/receipt-storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const user = await requireUser();

  const a = await prisma.ticketAttachment.findFirst({
    where: { fileName, companyId: user.companyId },
    select: {
      fileName: true, originalName: true, mimeType: true,
      ticket: { select: { clientId: true, requesterId: true, assigneeId: true, createdById: true } },
      comment: { select: { internal: true } },
    },
  });
  if (!a) return new NextResponse("Not found", { status: 404 });

  // Access: internal staff (view perm or involved), or the ticket's own customer (never an internal note).
  let allowed = false;
  if (user.role === "CUSTOMER") {
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
    allowed = !!me?.clientId && me.clientId === a.ticket.clientId && !a.comment?.internal;
  } else {
    const involved = a.ticket.requesterId === user.id || a.ticket.assigneeId === user.id || a.ticket.createdById === user.id;
    allowed = can(user, "tickets:view") || involved;
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const buffer = await readReceiptFile(fileName, "tickets");
  if (!buffer) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": a.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(a.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
