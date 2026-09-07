-- Threaded ticket replies + attachments on comments (SAP screenshots etc.)

ALTER TABLE "TicketComment" ADD COLUMN "parentId" TEXT;
CREATE INDEX "TicketComment_parentId_idx" ON "TicketComment"("parentId");
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAttachment" ADD COLUMN "commentId" TEXT;
CREATE INDEX "TicketAttachment_commentId_idx" ON "TicketAttachment"("commentId");
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
