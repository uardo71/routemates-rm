import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { receiptFilePath } from "@/lib/receipt-storage";
import { avatarContentType } from "@/lib/avatar";

// Serves user avatar images. They live outside public/ (uploads/avatars), so this authenticated
// route is the only way to reach them. Any signed-in member of the same company may view a
// teammate's avatar (they show up across lists, the sidebar, the profile), so authorization is a
// same-company check — mirrors the receipts/documents routes.
export async function GET(_req: Request, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const viewer = await requireUser();

  const owner = await prisma.user.findFirst({
    where: { avatarUrl: fileName },
    select: { companyId: true },
  });
  // 404 (not 403) on cross-tenant / unknown so we never leak that a file exists.
  if (!owner || owner.companyId !== viewer.companyId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await readFile(receiptFilePath(fileName, "avatars"));
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": avatarContentType(fileName),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
