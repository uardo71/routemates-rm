import { describe, it, expect } from "vitest";
import { taskCode, resolveLineTask, buildUnits, netZeroEntryIds, allocateUnits, type LinkEntry, type LinkTask } from "@/lib/invoice-time-link";

const MS = "neptune";
const tasks: LinkTask[] = [
  { id: "t18816", name: "[P018816] [eWCM] Digitalisierung Sicherungslisten - Vorprojekt & Phase 1", milestoneId: MS },
  { id: "t19278", name: "[P019278] Service für Mobile Abwicklung / Formulare und weiteres _infraserv", milestoneId: MS },
  { id: "t19692", name: "[P019692] Wartungsvertrag Schichtbuch 2026-2029", milestoneId: MS },
  { id: "t19912", name: "[P019912] Systemservice elektronische Arbeitsfreigabe „eAF/ eWCM“ 2026", milestoneId: MS },
  { id: "t20571", name: "[P020571] eWCM-Rollout Q1 / Q2 2026 & Weiterentwicklung - Service - RC1 / C", milestoneId: MS },
  { id: "t21103", name: "[P021103] Neptune Support | Service Kontingent", milestoneId: MS },
  { id: "t21692", name: "[P021692] Beratung Neptune & SSO", milestoneId: MS },
];
let n = 0;
const e = (date: string, hours: number, taskId: string | null = null, assignmentId = "indri"): LinkEntry => ({ id: `e${++n}`, date, hours, taskId, assignmentId, milestoneId: MS });
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe("task on an invoice line", () => {
  it("reads the [code] first, then the full name", () => {
    expect(taskCode("[P019912] Systemservice")).toBe("p019912");
    expect(taskCode("No code here")).toBeNull();
    expect(resolveLineTask("[P019912] Systemservice elektronische Arbeits", tasks)).toBe("t19912");
    expect(resolveLineTask("Invoice for [p021103] support", tasks)).toBe("t21103");
    expect(resolveLineTask("Beratung Neptune & SSO — August", tasks)).toBe("t21692");
    expect(resolveLineTask("Consulting services", tasks)).toBeNull();
  });
  it("never guesses between two equally good tasks", () => {
    const dup: LinkTask[] = [{ id: "a", name: "Support", milestoneId: "m1" }, { id: "b", name: "Support", milestoneId: "m2" }];
    expect(resolveLineTask("Support July", dup)).toBeNull();
    expect(resolveLineTask("Support July", dup, "m2")).toBe("b"); // the line's milestone settles it
  });
});

describe("units: a correction travels with the hours it corrects", () => {
  it("nets same-day corrections and drops +4/−4 pairs to zero", () => {
    const xs = [e("2026-07-13", 4), e("2026-07-13", -2), e("2026-08-03", 4), e("2026-08-03", -4)];
    const u = buildUnits(xs);
    expect(u.map((x) => [x.date, x.hours, x.entryIds.length])).toEqual([["2026-07-13", 2, 2], ["2026-08-03", 0, 2]]);
    expect([...netZeroEntryIds(xs)].sort()).toEqual([xs[2].id, xs[3].id].sort());
  });
  it("folds a later-day correction into the latest earlier day of the same assignment + task", () => {
    const xs = [e("2026-07-01", 8, "t19912"), e("2026-07-02", 6, "t19912"), e("2026-07-10", -3, "t19912"), e("2026-07-10", 5, null)];
    const u = buildUnits(xs);
    expect(u.find((x) => x.date === "2026-07-02")!.hours).toBe(3);
    expect(u.find((x) => x.date === "2026-07-02")!.entryIds).toHaveLength(2);
    expect(u.some((x) => x.date === "2026-07-10" && x.taskId === "t19912")).toBe(false);
    expect(u.find((x) => x.date === "2026-07-10")!.hours).toBe(5); // the untagged day is its own stream
  });
  it("keeps a correction with nothing earlier to net against as a negative unit", () => {
    const xs = [e("2026-07-10", -3, "t19912")];
    expect(buildUnits(xs)[0].hours).toBe(-3);
    expect(netZeroEntryIds(xs).size).toBe(0);
  });
  it("keeps different people apart", () => {
    const u = buildUnits([e("2026-07-13", 4, null, "indri"), e("2026-07-13", -4, null, "enida")]);
    expect(u.map((x) => x.hours).sort()).toEqual([-4, 4]);
  });
});

describe("allocating a billing period", () => {
  it("Neptune July: 46h logged without tasks lands exactly on four task invoices totalling 46h", () => {
    const july = [
      ...["13", "14", "15", "16", "17"].flatMap((d) => [e(`2026-07-${d}`, 4), e(`2026-07-${d}`, -2)]),
      ...["20", "21", "22", "23", "24"].map((d) => e(`2026-07-${d}`, 4)),
      e("2026-07-27", 2), e("2026-07-28", 2),
      ...["29", "30", "31"].map((d) => e(`2026-07-${d}`, 4)),
    ];
    const lines = [
      { id: "INV-0002", quantity: 27, milestoneId: null, taskId: "t18816" },
      { id: "INV-0003", quantity: 1.5, milestoneId: null, taskId: "t19692" },
      { id: "INV-0005", quantity: 3, milestoneId: null, taskId: "t21692" },
      { id: "INV-0004", quantity: 14.5, milestoneId: null, taskId: "t19912" },
    ];
    const r = allocateUnits(lines, buildUnits(july));
    expect(r.links.size).toBe(july.length); // every entry, the −2h corrections included
    expect(r.unassigned).toEqual([]);
    expect(sum([...r.lineHours.values()])).toBe(46);
  });

  it("Neptune August: task time goes to its own task's invoice; the +4/−4 planning pairs stay out", () => {
    const tagged = [
      e("2026-08-03", 4, "t20571"), e("2026-08-03", 3, "t21103"), e("2026-08-03", 0.5, "t21692"),
      e("2026-08-04", 10, "t19278"), e("2026-08-05", 9, "t18816"),
      e("2026-08-06", 8, "t19912"), e("2026-08-07", 8, "t19912"), e("2026-08-08", 8, "t19912"), e("2026-08-09", 1.5, "t19912"),
    ];
    const pairs = ["03", "04", "05", "06", "07"].flatMap((d) => [e(`2026-08-${d}`, 4), e(`2026-08-${d}`, -4)]);
    const lines = [
      { id: "INV-0014", quantity: 9, milestoneId: null, taskId: "t18816" },
      { id: "INV-0009", quantity: 0.5, milestoneId: null, taskId: "t21692" },
      { id: "INV-0010", quantity: 3, milestoneId: null, taskId: "t21103" },
      { id: "INV-0011", quantity: 4, milestoneId: null, taskId: "t20571" },
      { id: "INV-0012", quantity: 25.5, milestoneId: null, taskId: "t19912" },
      { id: "INV-0013", quantity: 10, milestoneId: null, taskId: "t19278" },
    ];
    const r = allocateUnits(lines, buildUnits([...tagged, ...pairs]));
    expect(Object.fromEntries(r.lineHours)).toEqual({ "INV-0014": 9, "INV-0009": 0.5, "INV-0010": 3, "INV-0011": 4, "INV-0012": 25.5, "INV-0013": 10 });
    for (const t of tagged) expect(r.links.get(t.id)).toBe(lines.find((l) => l.taskId === t.taskId)!.id);
    for (const p of pairs) expect(r.links.has(p.id)).toBe(false);
    expect([...netZeroEntryIds([...tagged, ...pairs])]).toHaveLength(pairs.length);
  });

  it("never takes another task's time, and leaves genuinely unbilled hours unbilled", () => {
    const xs = [e("2026-08-01", 6, "t19912"), e("2026-08-02", 5, "t21103")];
    const r = allocateUnits([{ id: "L", quantity: 20, milestoneId: null, taskId: "t19912" }], buildUnits(xs));
    expect(r.lineHours.get("L")).toBe(6);
    expect(r.unassigned.map((u) => u.taskId)).toEqual(["t21103"]);
  });

  it("never links more hours than invoiced in total", () => {
    const xs = [e("2026-08-01", 4), e("2026-08-02", 4), e("2026-08-03", 4)];
    const r = allocateUnits([{ id: "A", quantity: 3, milestoneId: null, taskId: null }, { id: "B", quantity: 3, milestoneId: null, taskId: null }], buildUnits(xs));
    expect(sum([...r.lineHours.values()])).toBeLessThanOrEqual(6 + 2); // at most one unit straddles
    expect(r.links.size).toBe(1); // 4h fits across A+B (6h of room); a second 4h would exceed the total
    expect(r.unassigned).toHaveLength(2);
  });

  it("a line on another milestone never takes this milestone's time", () => {
    const r = allocateUnits([{ id: "L", quantity: 10, milestoneId: "other", taskId: null }], buildUnits([e("2026-08-01", 4)]));
    expect(r.links.size).toBe(0);
  });
});
