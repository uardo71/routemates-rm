import type { UatResult, UatScriptStatus, UatIssueStatus } from "@prisma/client";

const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export type UatAreaData = { id: string; name: string; overview: string; dataRequirements: string };
export type UatCaseData = {
  id: string;
  areaId: string;
  description: string;
  prerequisites: string;
  expectedResults: string;
  runBy: string;
  dateRun: string;
  result: UatResult;
  reasonForFailure: string;
  docNo: string;
  comments: string;
};
export type UatIssueData = {
  id: string;
  areaRef: string;
  testRef: string;
  type: string;
  description: string;
  correctiveAction: string;
  assigned: string;
  status: UatIssueStatus;
  dateRaised: string;
  dateClosed: string;
};
export type UatData = {
  status: UatScriptStatus;
  sentAt: string;
  areas: UatAreaData[];
  cases: UatCaseData[];
  issues: UatIssueData[];
};

export function serializeArea(a: { id: string; name: string; overview: string | null; dataRequirements: string | null }): UatAreaData {
  return { id: a.id, name: a.name, overview: a.overview ?? "", dataRequirements: a.dataRequirements ?? "" };
}

export function serializeCase(c: {
  id: string; areaId: string; description: string | null; prerequisites: string | null; expectedResults: string | null;
  runBy: string | null; dateRun: Date | null; result: UatResult; reasonForFailure: string | null; docNo: string | null; comments: string | null;
}): UatCaseData {
  return {
    id: c.id, areaId: c.areaId,
    description: c.description ?? "", prerequisites: c.prerequisites ?? "", expectedResults: c.expectedResults ?? "",
    runBy: c.runBy ?? "", dateRun: d10(c.dateRun), result: c.result,
    reasonForFailure: c.reasonForFailure ?? "", docNo: c.docNo ?? "", comments: c.comments ?? "",
  };
}

export function serializeIssue(i: {
  id: string; areaRef: string | null; testRef: string | null; type: string | null; description: string | null;
  correctiveAction: string | null; assigned: string | null; status: UatIssueStatus; dateRaised: Date | null; dateClosed: Date | null;
}): UatIssueData {
  return {
    id: i.id, areaRef: i.areaRef ?? "", testRef: i.testRef ?? "", type: i.type ?? "", description: i.description ?? "",
    correctiveAction: i.correctiveAction ?? "", assigned: i.assigned ?? "", status: i.status,
    dateRaised: d10(i.dateRaised), dateClosed: d10(i.dateClosed),
  };
}
