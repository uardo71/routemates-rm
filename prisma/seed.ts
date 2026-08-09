import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const passwordHash = await hashPassword("password123");

  const company = await prisma.company.create({
    data: { name: "Routemates", currency: "USD" },
  });

  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      email: "admin@routemates.test",
      passwordHash,
      name: "Ada Admin",
      role: "ADMIN",
    },
  });

  const financeUser = await prisma.user.create({
    data: {
      companyId: company.id,
      email: "finance@routemates.test",
      passwordHash,
      name: "Fin Ance",
      role: "FINANCE",
    },
  });

  const pm = await prisma.user.create({
    data: {
      companyId: company.id,
      email: "pm@routemates.test",
      passwordHash,
      name: "Priya Manager",
      role: "PM",
      employment: {
        create: { type: "EMPLOYEE", costRate: 70, startDate: new Date("2023-01-01") },
      },
    },
  });

  const dev = await prisma.user.create({
    data: {
      companyId: company.id,
      email: "dev@routemates.test",
      passwordHash,
      name: "Dana Developer",
      role: "EMPLOYEE",
      employment: {
        create: { type: "EMPLOYEE", costRate: 60, startDate: new Date("2023-06-01") },
      },
    },
  });

  const contractor = await prisma.user.create({
    data: {
      companyId: company.id,
      email: "contractor@routemates.test",
      passwordHash,
      name: "Cory Contractor",
      role: "CONTRACTOR",
      employment: {
        create: {
          type: "CONTRACTOR",
          costRate: 90,
          startDate: new Date("2024-02-01"),
        },
      },
    },
  });

  // ---------- Client A: Northwind Traders — FIXED_PRICE project ----------

  const northwind = await prisma.client.create({
    data: {
      companyId: company.id,
      name: "Northwind Traders",
      contacts: { create: [{ name: "Nancy Northwind", email: "nancy@northwind.test" }] },
    },
  });

  const northwindProject = await prisma.project.create({
    data: {
      companyId: company.id,
      clientId: northwind.id,
      name: "Northwind Website Revamp",
      status: "ACTIVE",
      billingType: "FIXED_PRICE",
      budgetAmount: 50000,
      startDate: new Date("2026-06-01"),
      managerId: pm.id,
    },
  });

  const northwindPhase1 = await prisma.milestone.create({
    data: {
      projectId: northwindProject.id,
      name: "Website Revamp — Phase 1",
      billable: true,
      salesPrice: 20000,
      cost: 12000,
      budgetHours: 160,
      status: "ACTIVE",
      timeEntryOpen: true,
      startDate: new Date("2026-06-01"),
      tasks: {
        create: [
          { name: "Design mockups", status: "DONE", estimatedHours: 20 },
          { name: "Frontend build", status: "IN_PROGRESS", estimatedHours: 80, assigneeId: dev.id },
          { name: "Backend API", status: "IN_PROGRESS", estimatedHours: 60, assigneeId: contractor.id },
        ],
      },
    },
    include: { tasks: true },
  });

  const northwindOverhead = await prisma.milestone.create({
    data: {
      projectId: northwindProject.id,
      name: "Internal Sync & PM Overhead",
      billable: false,
      salesPrice: 0,
      cost: 1000,
      budgetHours: 20,
      status: "ACTIVE",
      timeEntryOpen: true,
    },
  });

  const northwindAsgStart = new Date("2026-06-01");
  const northwindAsgEnd = new Date("2026-12-31");

  const [, devAssignmentPhase1, contractorAssignmentPhase1] = await Promise.all([
    prisma.assignment.create({
      data: {
        milestoneId: northwindPhase1.id,
        userId: pm.id,
        costRate: 70,
        status: "ACTIVE",
        startDate: northwindAsgStart,
        endDate: northwindAsgEnd,
      },
    }),
    prisma.assignment.create({
      data: {
        milestoneId: northwindPhase1.id,
        userId: dev.id,
        costRate: 60,
        allocatedHours: 90,
        status: "ACTIVE",
        startDate: northwindAsgStart,
        endDate: northwindAsgEnd,
      },
    }),
    prisma.assignment.create({
      data: {
        milestoneId: northwindPhase1.id,
        userId: contractor.id,
        costRate: 90,
        allocatedHours: 70,
        status: "ACTIVE",
        startDate: northwindAsgStart,
        endDate: northwindAsgEnd,
      },
    }),
  ]);

  await prisma.assignment.create({
    data: {
      milestoneId: northwindOverhead.id,
      userId: pm.id,
      costRate: 70,
      allocatedHours: 20,
      status: "ACTIVE",
      startDate: northwindAsgStart,
      endDate: northwindAsgEnd,
    },
  });

  const frontendTask = northwindPhase1.tasks.find((t) => t.name === "Frontend build")!;
  const backendTask = northwindPhase1.tasks.find((t) => t.name === "Backend API")!;

  // ---------- Client B: Globex Corp — RETAINER (AFW) project ----------

  const globex = await prisma.client.create({
    data: {
      companyId: company.id,
      name: "Globex Corp",
      contacts: { create: [{ name: "Greg Globex", email: "greg@globex.test" }] },
    },
  });

  const globexProject = await prisma.project.create({
    data: {
      companyId: company.id,
      clientId: globex.id,
      name: "Globex Annual Support (AFW)",
      status: "ACTIVE",
      billingType: "RETAINER",
      budgetHours: 960,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      managerId: pm.id,
    },
  });

  const globexRetainer = await prisma.milestone.create({
    data: {
      projectId: globexProject.id,
      name: "2026 Support Retainer",
      billable: true,
      salesPrice: 130,
      cost: 70000,
      budgetHours: 960,
      status: "ACTIVE",
      timeEntryOpen: true,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });

  const devAssignmentRetainer = await prisma.assignment.create({
    data: {
      milestoneId: globexRetainer.id,
      userId: dev.id,
      costRate: 60,
      status: "ACTIVE",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });

  await prisma.assignment.create({
    data: {
      milestoneId: globexRetainer.id,
      userId: contractor.id,
      costRate: 90,
      allocatedHours: 200,
      status: "ACTIVE",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });

  // ---------- Client C: Initech — TIME_AND_MATERIALS budget pool + change request ----------

  const initech = await prisma.client.create({
    data: {
      companyId: company.id,
      name: "Initech",
      contacts: { create: [{ name: "Ira Initech", email: "ira@initech.test" }] },
    },
  });

  const initechProject = await prisma.project.create({
    data: {
      companyId: company.id,
      clientId: initech.id,
      name: "Initech Enhancements Budget",
      status: "ACTIVE",
      billingType: "TIME_AND_MATERIALS",
      budgetAmount: 60000,
      budgetHours: 500,
      startDate: new Date("2026-03-01"),
      managerId: pm.id,
    },
  });

  const initechCore = await prisma.milestone.create({
    data: {
      projectId: initechProject.id,
      name: "Core Enhancements Budget",
      billable: true,
      salesPrice: 110,
      cost: 30000,
      budgetHours: 460,
      status: "ACTIVE",
      timeEntryOpen: true,
    },
  });

  const initechCr001 = await prisma.milestone.create({
    data: {
      projectId: initechProject.id,
      name: "CR-001: Reporting Export Feature",
      billable: true,
      salesPrice: 140,
      cost: 2000,
      budgetHours: 40,
      status: "ACTIVE",
      timeEntryOpen: true,
      tasks: { create: [{ name: "Build CSV export", status: "IN_PROGRESS", estimatedHours: 40, assigneeId: dev.id }] },
    },
    include: { tasks: true },
  });

  const initechAsgStart = new Date("2026-03-01");
  const initechAsgEnd = new Date("2026-12-31");

  const devAssignmentCore = await prisma.assignment.create({
    data: {
      milestoneId: initechCore.id,
      userId: dev.id,
      costRate: 60,
      status: "ACTIVE",
      startDate: initechAsgStart,
      endDate: initechAsgEnd,
    },
  });

  const devAssignmentCr001 = await prisma.assignment.create({
    data: {
      milestoneId: initechCr001.id,
      userId: dev.id,
      costRate: 60,
      allocatedHours: 40,
      status: "ACTIVE",
      startDate: initechAsgStart,
      endDate: initechAsgEnd,
    },
  });

  const csvExportTask = initechCr001.tasks[0];

  // ---------- Time entries ----------

  const lastWeekStart = startOfWeek(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const thisWeekStart = startOfWeek(new Date());

  // A submitted-but-not-yet-decided card: dev logged hours against the Northwind frontend task
  // last week and submitted it — awaiting Priya's decision.
  const frontendCardLastWeek = await prisma.timeCard.create({
    data: {
      userId: dev.id,
      assignmentId: devAssignmentPhase1.id,
      milestoneId: northwindPhase1.id,
      weekStartDate: lastWeekStart,
      status: "SUBMITTED",
      submittedAt: new Date(),
      approverId: pm.id,
    },
  });
  await prisma.timeEntry.createMany({
    data: [
      {
        userId: dev.id,
        assignmentId: devAssignmentPhase1.id,
        milestoneId: northwindPhase1.id,
        taskId: frontendTask.id,
        timeCardId: frontendCardLastWeek.id,
        date: lastWeekStart,
        hours: 8,
        description: "Set up component library",
      },
      {
        userId: dev.id,
        assignmentId: devAssignmentPhase1.id,
        milestoneId: northwindPhase1.id,
        taskId: frontendTask.id,
        timeCardId: frontendCardLastWeek.id,
        date: new Date(lastWeekStart.getTime() + 24 * 60 * 60 * 1000),
        hours: 6.5,
        description: "Homepage layout",
      },
    ],
  });

  // A second, independent card for a different project the same week — already approved, to
  // demonstrate that each line's status is decided on its own (not the whole week at once).
  const retainerCardLastWeek = await prisma.timeCard.create({
    data: {
      userId: dev.id,
      assignmentId: devAssignmentRetainer.id,
      milestoneId: globexRetainer.id,
      weekStartDate: lastWeekStart,
      status: "APPROVED",
      submittedAt: new Date(),
      approverId: pm.id,
      decidedAt: new Date(),
      comment: "Looks good",
    },
  });
  await prisma.timeEntry.create({
    data: {
      userId: dev.id,
      assignmentId: devAssignmentRetainer.id,
      milestoneId: globexRetainer.id,
      timeCardId: retainerCardLastWeek.id,
      date: new Date(lastWeekStart.getTime() + 2 * 24 * 60 * 60 * 1000),
      hours: 5,
      description: "Monthly maintenance & patching",
    },
  });

  // Draft (unsubmitted) cards this week — draft hours don't count as approved actuals yet.
  const backendDraftCard = await prisma.timeCard.create({
    data: {
      userId: contractor.id,
      assignmentId: contractorAssignmentPhase1.id,
      milestoneId: northwindPhase1.id,
      weekStartDate: thisWeekStart,
      status: "DRAFT",
    },
  });
  await prisma.timeEntry.create({
    data: {
      userId: contractor.id,
      assignmentId: contractorAssignmentPhase1.id,
      milestoneId: northwindPhase1.id,
      taskId: backendTask.id,
      timeCardId: backendDraftCard.id,
      date: new Date(),
      hours: 4,
      description: "API scaffolding (unsubmitted)",
    },
  });

  const csvDraftCard = await prisma.timeCard.create({
    data: {
      userId: dev.id,
      assignmentId: devAssignmentCr001.id,
      milestoneId: initechCr001.id,
      weekStartDate: thisWeekStart,
      status: "DRAFT",
    },
  });
  await prisma.timeEntry.create({
    data: {
      userId: dev.id,
      assignmentId: devAssignmentCr001.id,
      milestoneId: initechCr001.id,
      taskId: csvExportTask.id,
      timeCardId: csvDraftCard.id,
      date: new Date(),
      hours: 6,
      description: "CSV export — initial pass (unsubmitted)",
    },
  });

  void devAssignmentCore;

  console.log("Seed complete.");
  console.log("Login with any of these (password: password123):");
  console.log(`  ${admin.email} (ADMIN)`);
  console.log(`  ${financeUser.email} (FINANCE)`);
  console.log(`  ${pm.email} (PM)`);
  console.log(`  ${dev.email} (EMPLOYEE)`);
  console.log(`  ${contractor.email} (CONTRACTOR)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
