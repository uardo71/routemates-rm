// notifyClientTeam must fire for portal-raised tickets and for nothing else. That guarantee is
// structural — it has exactly one call site — so this test fails the day someone wires it into a
// staff path, rather than customers' teams quietly getting notifications they shouldn't.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SRC = join(process.cwd(), "src");
const rel = (f: string) => f.slice(process.cwd().length + 1).split(sep).join("/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the client-team notification has exactly one call site", () => {
  const callers = sourceFiles(SRC)
    .filter((f) => !f.endsWith(`${sep}ticket-notify.ts`) && !f.includes(`${sep}__tests__${sep}`))
    .filter((f) => readFileSync(f, "utf8").includes("notifyClientTeam"));

  it("is called only from the portal's create action", () => {
    expect(callers.map(rel)).toEqual(["src/app/portal/portal-actions.ts"]);
  });

  it("the staff create path never notifies a client team", () => {
    const staffActions = readFileSync(join(SRC, "app", "(app)", "tickets", "actions.ts"), "utf8");
    expect(staffActions).not.toContain("notifyClientTeam");
  });
});
