import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { MailIcon, MapPinIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { can, STAFF_ONLY } from "@/lib/permissions";
import { avatarSrc } from "@/lib/avatar";
import { Card } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { RoleBadge } from "@/components/role-badge";
import { SkillsSummary } from "@/components/skills-summary";

export const metadata = { title: "Person" };

// Read-only skills & certifications of a colleague, for whoever staffs work (people:search).
// Editing stays with the person on /profile; admins get the same card on /admin/users/[id].
export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const user = await requirePermission("people:search");
  const p = await prisma.user.findFirst({
    where: { id: userId, companyId: user.companyId, ...STAFF_ONLY },
    select: {
      id: true, name: true, email: true, role: true, title: true, location: true, avatarUrl: true, bio: true,
      skills: { select: { level: true, lastUsedYear: true, skill: { select: { name: true, category: true } } } },
      certifications: { orderBy: [{ expiryDate: "asc" }], select: { id: true, name: true, issuer: true, issuedDate: true, expiryDate: true, document: { select: { fileName: true, originalName: true } } } },
    },
  });
  if (!p) notFound();
  const today = format(new Date(), "yyyy-MM-dd");
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <BackLink href="/people" label="Find people" />
      </div>
      <Card className="flex flex-row flex-wrap items-center gap-4 p-5">
        <InitialsAvatar name={p.name} src={avatarSrc(p.avatarUrl)} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{p.name}</h1><RoleBadge role={p.role} /></div>
          {p.title && <p className="text-sm text-muted-foreground">{p.title}</p>}
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MailIcon className="size-3" />{p.email}</span>
            {p.location && <span className="inline-flex items-center gap-1"><MapPinIcon className="size-3" />{p.location}</span>}
          </div>
          {p.bio && <p className="mt-2 max-w-2xl text-sm text-foreground/80">{p.bio}</p>}
        </div>
        {can(user, "users:manage") && <Link href={`/admin/users/${p.id}`} className="text-sm text-primary hover:underline">Manage user →</Link>}
        {user.id === p.id && <Link href="/profile" className="text-sm text-primary hover:underline">Edit my profile →</Link>}
      </Card>
      <SkillsSummary
        today={today}
        skills={p.skills.map((s) => ({ name: s.skill.name, category: s.skill.category, level: s.level, lastUsedYear: s.lastUsedYear }))}
        certifications={p.certifications.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, issuedDate: iso(c.issuedDate), expiryDate: iso(c.expiryDate), file: c.document }))}
        emptyHint={user.id === p.id ? "You haven't rated any skills yet — add them on your profile." : `${p.name} hasn't rated any skills yet.`}
      />
    </div>
  );
}
