import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { loadDeliveryHome } from "@/lib/delivery-home";
import { getActiveGuides } from "@/lib/guides-server";
import { DeliveryHomeClient } from "./delivery-home-client";

export default async function DeliveryPage() {
  const user = await requirePermission("delivery:manage");

  const [{ dayItems, stats, upcoming }, me, guides] = await Promise.all([
    loadDeliveryHome(user),
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    getActiveGuides(user.companyId),
  ]);
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const firstName = (me?.name ?? "there").split(" ")[0];
  const todayLabel = format(new Date(), "EEE · d MMM yyyy");

  return (
    <DeliveryHomeClient
      greeting={greeting}
      firstName={firstName}
      todayLabel={todayLabel}
      isAdmin={user.role === "ADMIN"}
      dayItems={dayItems}
      stats={stats}
      upcoming={upcoming.slice(0, 6)}
      guides={guides}
    />
  );
}
