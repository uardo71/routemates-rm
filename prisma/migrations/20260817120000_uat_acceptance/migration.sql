-- Project-level UAT / customer acceptance sign-off + the ability to attach documents to a project.
-- Additive only: new nullable columns and a new optional Document.projectId link.

-- Project: UAT acceptance fields
ALTER TABLE "Project" ADD COLUMN "uatAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "uatAcceptedDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "uatSignatory" TEXT;
ALTER TABLE "Project" ADD COLUMN "uatNotes" TEXT;
ALTER TABLE "Project" ADD COLUMN "uatRecordedById" TEXT;
ALTER TABLE "Project" ADD COLUMN "uatRecordedAt" TIMESTAMP(3);

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_uatRecordedById_fkey"
  FOREIGN KEY ("uatRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Document: allow attaching to a project (e.g. the signed UAT acceptance)
ALTER TABLE "Document" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
