import { format } from "date-fns";
import { requirePermission } from "@/lib/session";
import { assembleCommandCenter } from "@/lib/command-center";
import { CommandCenterClient } from "./command-center-client";

export const metadata = { title: "Command center" };

export default async function CommandCenterPage() {
  const user = await requirePermission("reports:view");
  const data = await assembleCommandCenter(user);
  return <CommandCenterClient data={data} periodLabel={format(new Date(), "MMMM yyyy")} />;
}
