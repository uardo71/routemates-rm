-- Free-text "next steps" is superseded by the structured StatusReportAction rows; the column was
-- never written by the editor and only ever nulled on save.
ALTER TABLE "StatusReport" DROP COLUMN "nextSteps";
