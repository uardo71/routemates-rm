-- Standard payment terms per client (e.g. 30 = net 30). Defaults an invoice's due date at creation
-- and back-fills the AR aging date when an invoice has none. Null = no agreed terms (never guessed).
ALTER TABLE "Client" ADD COLUMN "paymentTermsDays" INTEGER;
