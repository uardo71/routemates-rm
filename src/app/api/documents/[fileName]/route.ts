import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { receiptFilePath } from "@/lib/receipt-storage";

// Serves invoice/opportunity document files. They live outside public/ (uploads/documents), so this
// is the only way to reach them — always authenticated + authorized. Mirrors the receipts route.
export async function GET(_req: Request, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const user = await requireUser();

  const doc = await prisma.document.findFirst({ where: { fileName } });
  // 404 (not 403) on cross-tenant so we don't leak that a file exists.
  if (!doc || doc.companyId !== user.companyId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Authorize by parent entity: invoice docs need invoices:manage (Admin/Finance); opportunity
  // docs need opportunities:view; project docs (e.g. the signed UAT acceptance) need projects:view.
  const allowed = doc.invoiceId
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

  let data: Buffer;
  try {
    data = await readFile(receiptFilePath(doc.fileName, "documents"));
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
