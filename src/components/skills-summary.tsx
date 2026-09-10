import { PaperclipIcon, AwardIcon, SparklesIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, SKILL_LEVEL_LABEL, LEVEL_TONE, certificationStatus, CERT_STATUS_LABEL, CERT_STATUS_TONE,
  type SkillCategoryKey, type SkillLevel,
} from "@/lib/skills";

// Read-only view of someone's skills and certifications — used on /admin/users/[id] and /people/[id].
// The person edits their own on /profile.

export type SkillSummaryRow = { name: string; category: SkillCategoryKey; level: number; lastUsedYear: number | null };
export type CertSummaryRow = { id: string; name: string; issuer: string | null; issuedDate: string | null; expiryDate: string | null; file: { fileName: string; originalName: string } | null };

export function LevelPill({ level }: { level: number }) {
  const l = Math.max(1, Math.min(5, level)) as SkillLevel;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", LEVEL_TONE[l])} title={SKILL_LEVEL_LABEL[l]}>
      {l}<span className="font-normal opacity-80">/5</span>
    </span>
  );
}

export function SkillsSummary({ skills, certifications, today, emptyHint }: { skills: SkillSummaryRow[]; certifications: CertSummaryRow[]; today: string; emptyHint?: string }) {
  const groups = SKILL_CATEGORIES.map((cat) => ({ cat, rows: skills.filter((s) => s.category === cat).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)) })).filter((g) => g.rows.length > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><SparklesIcon className="size-4 text-muted-foreground" /> Skills <span className="font-normal text-muted-foreground">({skills.length})</span></CardTitle>
          <CardDescription>Self-assessed, 1 basic → 5 expert.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">{emptyHint ?? "No skills recorded."}</p>}
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">{SKILL_CATEGORY_LABEL[g.cat]}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.rows.map((s) => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs" title={s.lastUsedYear ? `Last used ${s.lastUsedYear}` : undefined}>
                    {s.name} <LevelPill level={s.level} />
                    {s.lastUsedYear && <span className="text-[10px] text-muted-foreground">{s.lastUsedYear}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><AwardIcon className="size-4 text-muted-foreground" /> Certifications <span className="font-normal text-muted-foreground">({certifications.length})</span></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {certifications.length === 0 && <p className="text-sm text-muted-foreground">No certifications recorded.</p>}
          {certifications.map((c) => {
            const status = certificationStatus(c.expiryDate, today);
            return (
              <div key={c.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.issuer && <span className="text-xs text-muted-foreground">· {c.issuer}</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CERT_STATUS_TONE[status])}>{CERT_STATUS_LABEL[status]}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span>Issued {c.issuedDate ?? "—"}</span>
                  <span>Expires {c.expiryDate ?? "—"}</span>
                  {c.file && <a href={`/api/documents/${c.file.fileName}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><PaperclipIcon className="size-3" /> {c.file.originalName}</a>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
