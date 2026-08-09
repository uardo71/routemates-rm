import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, type Action, type SessionUser } from "@/lib/permissions";

/** Get the current session user, redirecting to /login if unauthenticated.
 *  Use in server components / server actions that require a logged-in user. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return { id: session.user.id, role: session.user.role, companyId: session.user.companyId };
}

/** Like requireUser, but also asserts a coarse-grained permission.
 *  Throws (surfacing as an error boundary) rather than redirecting, since
 *  reaching this state means a signed-in user hit a page/action they can't use. */
export async function requirePermission(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, action)) {
    throw new Error("You do not have permission to perform this action.");
  }
  return user;
}
