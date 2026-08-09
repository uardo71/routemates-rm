-- CreateTable
CREATE TABLE "LeaveReturn" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "workingDays" DECIMAL(5,2) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveReturn_leaveRequestId_idx" ON "LeaveReturn"("leaveRequestId");

-- AddForeignKey
ALTER TABLE "LeaveReturn" ADD CONSTRAINT "LeaveReturn_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveReturn" ADD CONSTRAINT "LeaveReturn_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
