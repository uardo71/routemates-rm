import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { readReceiptFile } from "@/lib/receipt-storage";
import { servedAs, contentDisposition } from "@/lib/file-types";

// Serves invoice/opportunity document files. They live outside public/ (uploads/documents), so this
// is the only way to reach them — always authenticated + authorized. Mirrors the receipts route.
export async function GET(_req: Request, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const user = await requireUser();

  const doc = await prisma.document.findFirst({ where: { fileName }, include: { certification: { select: { userId: true } } } });
  // 404 (not 403) on cross-tenant so we don't leak that a file exists.
  if (!doc || doc.companyId !== user.companyId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Authorize by parent entity: invoice docs need invoices:manage (Admin/Finance); opportunity
  // docs need opportunities:view; project docs (e.g. the signed UAT acceptance) need projects:view.
  // A certificate is the person's own file: the owner, whoever manages users, and staffing search.
  const allowed = doc.certification
    ? doc.certification.userId === user.id || can(user, "users:manage") || can(user, "people:search")
    : doc.invoiceId
    ? can(user, "invoices:manage")
    : doc.projectId
      ? can(user, "projects:view")
      : doc.taxPaymentId
        ? can(user, "taxes:manage")
        : doc.vendorPaymentId
          ? can(user, "vendors:manage")
          : can(user, "opportunities:view");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const data = await readReceiptFile(doc.fileName, "documents");
  if (!data) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // Images and PDFs open in the browser; anything else (MS Project, Office, e-mail, archives, HTML…)
  // downloads with a neutral type, so an uploaded file can never run script in the app's origin.
  const served = servedAs(doc.mimeType || "application/octet-stream");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": served.contentType,
      "Content-Disposition": contentDisposition(doc.originalName, served.inline),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
