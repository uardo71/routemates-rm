-- Edit / soft-delete for ticket comments
ALTER TABLE "TicketComment" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "TicketComment" ADD COLUMN "deletedAt" TIMESTAMP(3);
