-- Custom fields are archived instead of deleted: the definition and every stored value stay, the
-- field just leaves the input lists. Additive only — two nullable columns, no data touched.
ALTER TABLE "TicketFieldDef" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "TicketFieldDef" ADD COLUMN "archivedById" TEXT;
