// Pure helpers for skills, certifications and staffing search (no Prisma). The server halves are
// the profile / admin / people actions and pages.

export const SKILL_CATEGORIES = ["SAP_MODULE", "TECHNOLOGY", "LANGUAGE", "INDUSTRY", "METHODOLOGY"] as const;
export type SkillCategoryKey = (typeof SKILL_CATEGORIES)[number];

export const SKILL_CATEGORY_LABEL: Record<SkillCategoryKey, string> = {
  SAP_MODULE: "SAP module",
  TECHNOLOGY: "Technology",
  LANGUAGE: "Language",
  INDUSTRY: "Industry",
  METHODOLOGY: "Methodology",
};

export const SKILL_LEVELS = [1, 2, 3, 4, 5] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = { 1: "Basic", 2: "Working", 3: "Solid", 4: "Advanced", 5: "Expert" };
export const LEVEL_TONE: Record<SkillLevel, string> = {
  1: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  2: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
  3: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  4: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  5: "bg-primary/20 text-primary",
};

export function clampLevel(n: number): SkillLevel {
  return Math.max(1, Math.min(5, Math.round(n))) as SkillLevel;
}

/** A ready-made catalogue for an SAP practice — the admin seeds it once and edits from there. */
export const STARTER_SKILLS: { name: string; category: SkillCategoryKey }[] = [
  ...["FI", "CO", "MM", "SD", "PP", "PS", "PM", "QM", "WM / EWM", "HCM", "FI-AA", "FI-AP", "FI-AR", "Treasury", "DRC (Document & Reporting Compliance)", "eDocument", "VIM / OpenText", "Ariba", "SuccessFactors", "Concur", "S/4HANA Finance", "Group Reporting", "BPC", "Fiori", "BTP", "CPI / Integration Suite", "ABAP", "Basis"].map((name) => ({ name, category: "SAP_MODULE" as const })),
  ...["ABAP OO", "CDS views", "RAP", "SAPUI5", "JavaScript / TypeScript", "SQL", "Power BI", "Azure", "REST / OData"].map((name) => ({ name, category: "TECHNOLOGY" as const })),
  ...["English", "Italian", "Albanian", "German", "French", "Spanish"].map((name) => ({ name, category: "LANGUAGE" as const })),
  ...["Manufacturing", "Automotive", "Pharma / Life sciences", "Utilities", "Retail", "Oil & gas", "Public sector", "Professional services"].map((name) => ({ name, category: "INDUSTRY" as const })),
  ...["SAP Activate", "Agile / Scrum", "PMP / PRINCE2", "Data migration", "Cutover management", "Test management", "Training / OCM"].map((name) => ({ name, category: "METHODOLOGY" as const })),
];

// ---------- staffing search ----------

export type SkillRequirement = { skillId: string; minLevel: number };
export type PersonSkillsInput = {
  userId: string;
  /** skillId → level */
  levels: Record<string, number>;
  /** Free hours over the requested window (Σ of weekly free hours), when availability was loaded. */
  freeHours?: number;
  /** The smallest weekly free figure in the window — "is there ever a fully booked week". */
  minWeekFree?: number;
};
export type PersonMatch = {
  userId: string;
  /** Every requirement met at or above its minimum. */
  meetsAll: boolean;
  met: { skillId: string; level: number; minLevel: number }[];
  missing: { skillId: string; level: number | null; minLevel: number }[];
  /** Σ level over the requirements (0 when a requirement is missing) — ranks equally-qualified people. */
  score: number;
  freeHours: number | null;
  minWeekFree: number | null;
};

/** Who can do the job: each person against every requirement, full matches first, then by score,
 *  then by free hours (more first), then by name-agnostic stable order. With no requirements
 *  everyone "meets all" and the ranking is purely availability. */
export function matchPeople(people: PersonSkillsInput[], requirements: SkillRequirement[], opts: { minFreeHours?: number } = {}): PersonMatch[] {
  const out: PersonMatch[] = [];
  for (const p of people) {
    const met: PersonMatch["met"] = [];
    const missing: PersonMatch["missing"] = [];
    let score = 0;
    for (const r of requirements) {
      const level = p.levels[r.skillId];
      if (level != null && level >= r.minLevel) { met.push({ skillId: r.skillId, level, minLevel: r.minLevel }); score += level; }
      else missing.push({ skillId: r.skillId, level: level ?? null, minLevel: r.minLevel });
    }
    const freeHours = p.freeHours ?? null;
    if (opts.minFreeHours != null && opts.minFreeHours > 0 && (freeHours ?? 0) < opts.minFreeHours) continue;
    out.push({ userId: p.userId, meetsAll: missing.length === 0, met, missing, score, freeHours, minWeekFree: p.minWeekFree ?? null });
  }
  out.sort((a, b) =>
    Number(b.meetsAll) - Number(a.meetsAll) ||
    a.missing.length - b.missing.length ||
    b.score - a.score ||
    (b.freeHours ?? -1) - (a.freeHours ?? -1),
  );
  return out;
}

/** Parses the URL form "skillId:minLevel,skillId:minLevel" (minLevel defaults to 3). */
export function parseRequirements(raw: string | null | undefined, validIds?: Set<string>): SkillRequirement[] {
  if (!raw) return [];
  const out: SkillRequirement[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const [id, lvl] = part.split(":");
    const skillId = (id ?? "").trim();
    if (!skillId || seen.has(skillId)) continue;
    if (validIds && !validIds.has(skillId)) continue;
    seen.add(skillId);
    const n = Number(lvl);
    out.push({ skillId, minLevel: Number.isFinite(n) && n > 0 ? clampLevel(n) : 3 });
  }
  return out;
}
export function serializeRequirements(reqs: SkillRequirement[]): string {
  return reqs.map((r) => `${r.skillId}:${r.minLevel}`).join(",");
}

// ---------- team matrix ----------

export type SkillCoverage = {
  skillId: string;
  /** People at or above `minLevel`. */
  covered: number;
  maxLevel: number;
  /** Gap = nobody solid, or a single point of failure. */
  gap: "NONE" | "SINGLE" | "MISSING";
};

/** Where the team is thin: a skill nobody holds at `minLevel` is MISSING; one person only is SINGLE. */
export function skillCoverage(levelsBySkill: { skillId: string; levels: number[] }[], opts: { minLevel?: number; minPeople?: number } = {}): SkillCoverage[] {
  const minLevel = opts.minLevel ?? 3;
  const minPeople = opts.minPeople ?? 2;
  return levelsBySkill.map(({ skillId, levels }) => {
    const covered = levels.filter((l) => l >= minLevel).length;
    const maxLevel = levels.length ? Math.max(...levels) : 0;
    return { skillId, covered, maxLevel, gap: covered === 0 ? "MISSING" : covered < minPeople ? "SINGLE" : "NONE" };
  });
}

// ---------- certifications ----------

export type CertificationStatus = "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY";

/** Days from `todayIso` to `expiryIso` (UTC dates); negative when already past. */
export function daysToExpiry(expiryIso: string, todayIso: string): number {
  const a = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  const b = Date.UTC(+expiryIso.slice(0, 4), +expiryIso.slice(5, 7) - 1, +expiryIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function certificationStatus(expiryIso: string | null, todayIso: string, expiringWithinDays = 90): CertificationStatus {
  if (!expiryIso) return "NO_EXPIRY";
  const left = daysToExpiry(expiryIso, todayIso);
  if (left < 0) return "EXPIRED";
  if (left <= expiringWithinDays) return "EXPIRING";
  return "VALID";
}

export const CERT_STATUS_LABEL: Record<CertificationStatus, string> = { VALID: "Valid", EXPIRING: "Expiring soon", EXPIRED: "Expired", NO_EXPIRY: "No expiry" };
export const CERT_STATUS_TONE: Record<CertificationStatus, string> = {
  VALID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  EXPIRING: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  EXPIRED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  NO_EXPIRY: "bg-muted text-muted-foreground",
};
