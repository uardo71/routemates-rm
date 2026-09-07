-- In-app per-user ticket notifications (reply / status / assignment)
CREATE TABLE "TicketNotification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketNotification_userId_readAt_idx" ON "TicketNotification"("userId", "readAt");
CREATE INDEX "TicketNotification_ticketId_idx" ON "TicketNotification"("ticketId");
ALTER TABLE "TicketNotification" ADD CONSTRAINT "TicketNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketNotification" ADD CONSTRAINT "TicketNotification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
