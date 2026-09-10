import { format } from "date-fns";
import { notFound } from "next/navigation";
import {
  MailIcon,
  PhoneIcon,
  MapPinIcon,
  CalendarIcon,
  BriefcaseIcon,
  PalmtreeIcon,
  ShieldIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { InfoField } from "@/components/info-field";
import { RoleBadge } from "@/components/role-badge";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { computeVacationBalance } from "@/lib/vacation";
import { avatarSrc } from "@/lib/avatar";
import { formatNumber } from "@/lib/format";
import { AvatarUploader } from "./avatar-uploader";
import { ProfileForm } from "./profile-form";
import { SkillsClient } from "./skills-client";

export default async function ProfilePage() {
  const session = await requireUser();

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    include: { employment: true },
  });
  if (!me) notFound();

  const [balance, activeAssignments, catalogue, mySkills, myCerts] = await Promise.all([
    computeVacationBalance(me.id),
    prisma.assignment.count({ where: { userId: me.id, status: "ACTIVE" } }),
    prisma.skill.findMany({ where: { companyId: me.companyId }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } }),
    prisma.userSkill.findMany({ where: { userId: me.id }, select: { skillId: true, level: true, lastUsedYear: true } }),
    prisma.certification.findMany({ where: { userId: me.id }, orderBy: [{ expiryDate: "asc" }, { name: "asc" }], select: { id: true, name: true, issuer: true, issuedDate: true, expiryDate: true, document: { select: { fileName: true, originalName: true } } } }),
  ]);
  const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const src = avatarSrc(me.avatarUrl);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My profile</h1>
        <p className="text-sm text-muted-foreground">Update how you show up across RM Ops.</p>
      </div>

      {/* Hero */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="h-24 bg-gradient-to-r from-primary/25 via-primary/10 to-transparent" />
        <div className="-mt-12 flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:gap-6">
          <AvatarUploader name={me.name} src={src} />
          <div className="flex flex-1 flex-col gap-2 pt-2 sm:pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold">{me.name}</h2>
              <RoleBadge role={me.role} />
              {me.active ? (
                <Badge variant="secondary">Active</Badge>
              ) : (
                <Badge variant="outline">Inactive</Badge>
              )}
            </div>
            {me.title && <p className="text-sm font-medium text-muted-foreground">{me.title}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MailIcon className="size-3.5" /> {me.email}
              </span>
              {me.phone && (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3.5" /> {me.phone}
                </span>
              )}
              {me.location && (
                <span className="flex items-center gap-1.5">
                  <MapPinIcon className="size-3.5" /> {me.location}
                </span>
              )}
            </div>
            {me.bio && <p className="max-w-2xl text-sm leading-relaxed text-foreground/80">{me.bio}</p>}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Edit form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Edit your details</CardTitle>
            <CardDescription>
              Changes save to your profile and appear across RM Ops right away.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              profile={{
                name: me.name,
                title: me.title,
                phone: me.phone,
                location: me.location,
                bio: me.bio,
              }}
            />
          </CardContent>
        </Card>

        {/* At a glance + account */}
        <div className="flex flex-col gap-4">
          <StatCard
            label="Vacation balance"
            value={`${formatNumber(balance.balance)} d`}
            sublabel={`${formatNumber(balance.taken)} taken in ${balance.year}`}
            icon={PalmtreeIcon}
          />
          <StatCard label="Active assignments" value={activeAssignments} icon={BriefcaseIcon} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InfoField icon={MailIcon} label="Email" value={me.email} />
              <InfoField icon={ShieldIcon} label="System role" value={<RoleBadge role={me.role} />} />
              <InfoField icon={CalendarIcon} label="Member since" value={format(me.createdAt, "MMM yyyy")} />
              {me.employment && (
                <InfoField
                  icon={BriefcaseIcon}
                  label="Employed since"
                  value={format(me.employment.startDate, "MMM d, yyyy")}
                />
              )}
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Your email, role, and pay are managed by an administrator — reach out to them to change these.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <SkillsClient
        catalogue={catalogue}
        mine={mySkills}
        certifications={myCerts.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, issuedDate: isoDay(c.issuedDate), expiryDate: isoDay(c.expiryDate), file: c.document }))}
        today={format(new Date(), "yyyy-MM-dd")}
      />
    </div>
  );
}
