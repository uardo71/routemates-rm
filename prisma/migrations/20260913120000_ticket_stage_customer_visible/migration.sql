-- The portal never had any concept of stage visibility (TicketStatusDef has had customerVisible
-- since the start; TicketStageDef never got the equivalent when STAGE mode was added). Additive
-- only — one boolean column, default true so every existing stage stays visible unless someone
-- opts it out.
ALTER TABLE "TicketStageDef" ADD COLUMN "customerVisible" BOOLEAN NOT NULL DEFAULT true;
