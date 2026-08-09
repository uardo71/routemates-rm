-- CreateTable
CREATE TABLE "AssignmentPlan" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentPlan_weekStartDate_idx" ON "AssignmentPlan"("weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentPlan_assignmentId_weekStartDate_key" ON "AssignmentPlan"("assignmentId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "AssignmentPlan" ADD CONSTRAINT "AssignmentPlan_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
