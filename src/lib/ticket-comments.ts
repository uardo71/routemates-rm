import "server-only";
import { prisma } from "@/lib/prisma";
import { validateFiles, saveTicketAttachments, cleanupSaved } from "@/lib/ticket-attachments";
import { deleteReceiptFile } from "@/lib/receipt-storage";
import { notifyTicketParticipants, userName } from "@/lib/ticket-notify";

/** Edit a comment's text (marks it edited). */
export async function editCommentBody(commentId: string, body: string): Promise<void> {
  await prisma.ticketComment.update({ where: { id: commentId }, data: { body: body.trim() || null, editedAt: new Date() } });
}

/** Soft-delete (tombstone) a comment so its replies survive: clears the body, removes its
 *  attachments (rows + files), stamps deletedAt. */
export async function softDeleteComment(commentId: string): Promise<void> {
  const atts = await prisma.ticketAttachment.findMany({ where: { commentId }, select: { fileName: true } });
  await prisma.$transaction([
    prisma.ticketAttachment.deleteMany({ where: { commentId } }),
    prisma.ticketComment.update({ where: { id: commentId }, data: { deletedAt: new Date(), body: null } }),
  ]);
  for (const a of atts) await deleteReceiptFile(a.fileName, "tickets");
}

/** Create a ticket comment (optionally a threaded reply) with attachments, in one transaction.
 *  Files are written to disk first; on any DB failure they're cleaned up. Returns {error} on
 *  validation failure. `parentId` is validated to belong to the same ticket. */
export async function postTicketComment(opts: {
  ticketId: string;
  companyId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  internal: boolean;
  files: File[];
  setFirstResponse: boolean;
}): Promise<{ error?: string; commentId?: string }> {
  const text = opts.body.trim();
  if (!text && opts.files.length === 0) return { error: "Add a message or an attachment." };
  const verr = validateFiles(opts.files);
  if (verr) return { error: verr };

  let parentId = opts.parentId;
  if (parentId) {
    const p = await prisma.ticketComment.findFirst({ where: { id: parentId, ticketId: opts.ticketId }, select: { id: true } });
    if (!p) return { error: "The comment you're replying to no longer exists." };
    parentId = p.id;
  }

  const saved = await saveTicketAttachments(opts.files);
  let commentId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const c = await tx.ticketComment.create({
        data: { ticketId: opts.ticketId, authorId: opts.authorId, kind: "COMMENT", body: text || null, internal: opts.internal, parentId },
        select: { id: true },
      });
      commentId = c.id;
      if (saved.length) {
        await tx.ticketAttachment.createMany({
          data: saved.map((s) => ({ ticketId: opts.ticketId, commentId: c.id, companyId: opts.companyId, fileName: s.fileName, originalName: s.originalName, mimeType: s.mimeType, sizeBytes: s.sizeBytes, uploadedById: opts.authorId })),
        });
      }
      if (opts.setFirstResponse) {
        const t = await tx.ticket.findUnique({ where: { id: opts.ticketId }, select: { firstResponseAt: true } });
        if (t && !t.firstResponseAt) await tx.ticket.update({ where: { id: opts.ticketId }, data: { firstResponseAt: new Date() } });
      }
    });
  } catch {
    await cleanupSaved(saved);
    return { error: "Could not post the comment. Please try again." };
  }
  // Notify the other participants (internal notes stay staff-only).
  await notifyTicketParticipants({
    ticketId: opts.ticketId, companyId: opts.companyId, actorId: opts.authorId,
    actorName: await userName(opts.authorId), kind: "COMMENT", summary: "replied", staffOnly: opts.internal,
  });
  return { commentId };
}
