import { requireUser } from "@/lib/session";
import { HelpClient } from "./help-client";

export const metadata = { title: "Help & documentation" };

export default async function HelpPage() {
  await requireUser(); // any signed-in user may read the docs
  return <HelpClient />;
}
