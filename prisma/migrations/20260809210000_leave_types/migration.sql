-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('VACATION', 'SICK', 'PATERNITY', 'MATERNITY');

-- RenameTable (existing rows are all genuinely vacation requests, so the type default is correct)
ALTER TABLE "VacationRequest" RENAME TO "LeaveRequest";

-- AddColumn
ALTER TABLE "LeaveRequest" ADD COLUMN "type" "LeaveType" NOT NULL DEFAULT 'VACATION';

-- CreateIndex
CREATE INDEX "LeaveRequest_type_idx" ON "LeaveRequest"("type");
