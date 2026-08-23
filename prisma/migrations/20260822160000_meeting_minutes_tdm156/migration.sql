ALTER TABLE "MeetingMinutes"
  ADD COLUMN "timeFrom" TEXT,
  ADD COLUMN "timeTo" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "minuteTaker" TEXT,
  ADD COLUMN "agendaTopic" TEXT,
  ADD COLUMN "agendaWho" TEXT,
  ADD COLUMN "agendaDuration" TEXT;

CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "role" TEXT,
    "group" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingParticipant_minutesId_idx" ON "MeetingParticipant"("minutesId");

ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
