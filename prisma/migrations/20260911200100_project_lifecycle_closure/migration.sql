-- Closure gate (-> COMPLETED): UAT can be marked not applicable, a milestone can be explicitly
-- written off, and an admin override is recorded like the activation one.
ALTER TABLE "Project"
  ADD COLUMN "uatNotApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "closureOverrideReason" TEXT,
  ADD COLUMN "closureOverrideAt" TIMESTAMP(3),
  ADD COLUMN "closureOverrideById" TEXT;

ALTER TABLE "Milestone"
  ADD COLUMN "writtenOffAt" TIMESTAMP(3),
  ADD COLUMN "writtenOffById" TEXT,
  ADD COLUMN "writtenOffReason" TEXT;

-- Day one of the lifecycle gate: time can only be logged on ACTIVE projects from now on. So that
-- nobody is stranded, every non-internal PLANNED or ON_HOLD project that had approved time in the
-- last 60 days becomes ACTIVE. (COMPLETED and CANCELLED are left alone: someone closed those on
-- purpose, and reopening one is an admin decision.) Each change is written to the audit log with
-- actor "system", which is the permanent report of what this step did.
CREATE TEMP TABLE _lifecycle_backfill AS
SELECT p.id, p."companyId", p.status::text AS old_status, COALESCE(p.number, p.name) AS label
FROM "Project" p
WHERE p."isInternal" = false
  AND p.status IN ('PLANNED', 'ON_HOLD')
  AND EXISTS (
    SELECT 1
    FROM "TimeEntry" e
    JOIN "TimeCard" c ON c.id = e."timeCardId" AND c.status = 'APPROVED'
    JOIN "Milestone" m ON m.id = e."milestoneId"
    WHERE m."projectId" = p.id AND e.date >= (CURRENT_DATE - INTERVAL '60 days')
  );

UPDATE "Project" p SET status = 'ACTIVE' FROM _lifecycle_backfill b WHERE p.id = b.id;

INSERT INTO "AuditLog" (id, "companyId", "entityType", "entityId", action, "actorId", at, summary, diff)
SELECT 'lcg' || md5(b.id || clock_timestamp()::text), b."companyId", 'Project', b.id, 'update', 'system', now(),
       b.label || ': status ' || b.old_status || ' -> ACTIVE (lifecycle gate: approved time in the last 60 days)',
       jsonb_build_object(
         'label', b.label,
         'parent', NULL,
         'fields', jsonb_build_object('status', jsonb_build_object('from', b.old_status, 'to', 'ACTIVE'))
       )
FROM _lifecycle_backfill b;

DROP TABLE _lifecycle_backfill;
