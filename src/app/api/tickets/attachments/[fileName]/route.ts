import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { readReceiptFile } from "@/lib/receipt-storage";
import { servedAs, contentDisposition } from "@/lib/file-types";

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
    allowed = involved || (await canManageClientTickets(user, a.ticket.clientId));
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const buffer = await readReceiptFile(fileName, "tickets");
  if (!buffer) {
    return new NextResponse("Not found", { status: 404 });
  }
  // Images and PDFs open in the browser; anything else (Office, e-mail, archives, HTML, SVG…) downloads
  // with a neutral type, so an uploaded file can never run script in the app's origin.
  const served = servedAs(a.mimeType || "application/octet-stream");
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": served.contentType,
      "Content-Disposition": contentDisposition(a.originalName, served.inline),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
