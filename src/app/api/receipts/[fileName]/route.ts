import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { readReceiptFile } from "@/lib/receipt-storage";

// Receipts are never served from /public — every request here is authenticated and scoped:
// Admin/Finance can view any receipt in their company, anyone else only their own (owner or
// the person who filed it).
export async function GET(_req: Request, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const user = await requireUser();

  const receipt = await prisma.expenseReceipt.findFirst({
    where: { fileName },
    include: { expense: true },
  });
  if (!receipt) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (receipt.expense.companyId !== user.companyId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isOwnerOrSubmitter = receipt.expense.userId === user.id || receipt.expense.submittedById === user.id;
  if (!can(user, "expenses:manage") && !isOwnerOrSubmitter) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const data = await readReceiptFile(receipt.fileName);
  if (!data) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": receipt.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
