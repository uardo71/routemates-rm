// SOP coaching guides — "How do I handle this?"
// Lean, rule-based playbook cards distilled from the Tungsten SOP library, adapted to Routemates'
// scale. Pure help for a junior PM, never a gate. Categories double as contextual trigger keys so a
// guide can be surfaced next to the matching situation in the cockpit (e.g. a status update due).

export type GuideCategory =
  | "change_request"
  | "slipping_date"
  | "sap"
  | "commercial"
  | "team"
  | "kickoff"
  | "unhappy_customer"
  | "escalation"
  | "status"
  | "golive"
  | "general";

export const GUIDE_CATEGORIES: { value: GuideCategory; label: string; icon: string; hint: string }[] = [
  { value: "change_request", label: "Scope & change requests", icon: "gitPullRequest", hint: "Customer asks for extra work" },
  { value: "slipping_date", label: "Dates at risk", icon: "alertTriangle", hint: "A deadline is slipping" },
  { value: "sap", label: "SAP delivery & technical", icon: "database", hint: "Transports, defects, cutover, data" },
  { value: "commercial", label: "Budget & billing", icon: "banknote", hint: "Money, estimates, invoices" },
  { value: "team", label: "Team & people", icon: "users", hint: "Resourcing, onboarding, syncs" },
  { value: "kickoff", label: "Kickoff & onboarding", icon: "flag", hint: "Starting a new project" },
  { value: "unhappy_customer", label: "Difficult conversations", icon: "messageSquareWarning", hint: "Customer is unhappy" },
  { value: "escalation", label: "Escalation", icon: "arrowUpCircle", hint: "Something needs raising" },
  { value: "status", label: "Status & reporting", icon: "fileText", hint: "Weekly customer update" },
  { value: "golive", label: "Go-live & handover", icon: "rocket", hint: "Approaching go-live" },
  { value: "general", label: "General", icon: "compass", hint: "Good practice" },
];

export const GUIDE_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  GUIDE_CATEGORIES.map((c) => [c.value, c.label]),
);
export const GUIDE_CATEGORY_ICON: Record<string, string> = Object.fromEntries(
  GUIDE_CATEGORIES.map((c) => [c.value, c.icon]),
);

export type GuideSeed = {
  title: string;
  category: GuideCategory;
  summary: string;
  steps: string[];
  source: string;
};

// Default coaching library, seeded once per company. Admin can edit/add/remove afterwards — the DB
// is the source of truth from then on, this constant is only the starting point.
export const DEFAULT_GUIDES: GuideSeed[] = [
  {
    title: "A customer asks for extra work",
    category: "change_request",
    summary: "Someone requests something that wasn't in the agreed scope.",
    steps: [
      "Don't commit on the spot — a friendly \"let me check and come back to you\" is fine.",
      "Check the SoW: is this already inside the agreed scope? If yes, just do it and note it.",
      "If it's outside scope, log it as a change request — capture what, why, and rough effort.",
      "Send a short note with the effort and schedule impact BEFORE any work starts.",
      "Only start once you have a written \"go ahead\" (email is enough).",
    ],
    source: "SOP: Change Requests / Project Work Management",
  },
  {
    title: "A deadline or milestone is going to slip",
    category: "slipping_date",
    summary: "You can see a date won't be met.",
    steps: [
      "Flag it early — a surprise on the due date is far worse than a heads-up two weeks out.",
      "Set the status severity honestly (Medium = delay, High = business impact) and say why.",
      "Come with a recovery option, not just a problem: add a person, re-sequence, or agree a new date.",
      "Confirm the agreed way forward in writing (status update or email).",
      "Tell your delivery lead — you don't have to carry a slipping date alone.",
    ],
    source: "SOP: Project Status / At-Risk Projects",
  },
  {
    title: "Running a project kickoff",
    category: "kickoff",
    summary: "Starting a new project or a new customer engagement.",
    steps: [
      "Confirm the essentials up front: scope, team & roles, key dates, and the go-live target.",
      "Walk the plan and be specific about the first two weeks — who does what.",
      "Agree the status cadence and the channel (weekly update, which day, to whom).",
      "Agree how change requests and issues will be raised.",
      "Write up the decisions and owners in the meeting minutes the SAME day.",
    ],
    source: "SOP: Project Onboarding / PM Activity Checklist",
  },
  {
    title: "The customer is unhappy",
    category: "unhappy_customer",
    summary: "A tense call, a complaint, or visible frustration.",
    steps: [
      "Listen first. Let them finish before you explain anything — don't get defensive.",
      "Separate facts from feelings, and own what's genuinely on us.",
      "Agree ONE concrete next step and a time you'll follow up. Small and specific beats big promises.",
      "Follow up when you said you would — reliability rebuilds trust faster than words.",
      "Tell your delivery lead early. A shared problem is easier and it protects you.",
    ],
    source: "SOP: Customer Escalation / Field Escalation",
  },
  {
    title: "Something needs escalating",
    category: "escalation",
    summary: "A blocker or risk you can't resolve at your level.",
    steps: [
      "Write it down first: what's blocked, the impact, and what you've already tried.",
      "Try to resolve it at your level or with the team before raising it.",
      "If still blocked, escalate up the line: PM → delivery lead → management.",
      "Keep the customer-side and internal escalations in sync — no surprises either way.",
      "Track it until it's closed; don't assume raising it once is enough.",
    ],
    source: "SOP: Project Issues & Risks / Escalation",
  },
  {
    title: "Sending the weekly customer status update",
    category: "status",
    summary: "The regular update every active customer should get.",
    steps: [
      "Send one every week for each active customer — predictable rhythm builds confidence.",
      "Base it on this week's approved hours and real plan progress, not a gut feeling.",
      "Keep the severity honest — green when it's green, amber the moment it isn't.",
      "Cover: progress, what's next, and anything that needs a decision from them.",
      "Send it, cc your delivery lead, and keep the copy — it's your record if billing is ever questioned.",
    ],
    source: "SOP: Minimal Project Status Report",
  },
  {
    title: "Approaching go-live and handover",
    category: "golive",
    summary: "The project is nearing production / closing.",
    steps: [
      "Confirm the cutover plan and that everyone knows their part and timing.",
      "Get UAT sign-off in writing BEFORE go-live — don't go live on a verbal \"looks fine\".",
      "Agree a hypercare period: who's on point and for how long after go-live.",
      "Hand over to support with a short transition note (what it is, known issues, contacts).",
      "Close the project cleanly: final status, lessons learned, and mark it complete.",
    ],
    source: "SOP: Project Closure / Transition to Support",
  },

  // ---- SAP delivery & technical ----
  {
    title: "A transport broke QA or Production",
    category: "sap",
    summary: "A change you moved caused errors in a downstream system.",
    steps: [
      "Freeze further transports until it's understood — don't move more on top of a broken system.",
      "Identify the transport and what it changed; read the import log for the real error, not the symptom.",
      "Decide fast: a fix-forward transport or a rollback — never leave the system broken over a decision.",
      "Tell the customer's Basis/lead the impact and your plan before they discover it themselves.",
      "Once stable, note what slipped through and tighten the release checklist so it can't repeat.",
    ],
    source: "SOP: Transport & Change Control",
  },
  {
    title: "A critical defect is found during UAT",
    category: "sap",
    summary: "The customer hits a blocking bug while testing.",
    steps: [
      "Log it properly: steps to reproduce, expected vs actual, screenshots, and a severity.",
      "Triage honestly — does it block go-live, or is it cosmetic? Don't treat everything as a fire.",
      "Give the customer a named owner and an ETA, even if the ETA is \"investigating, update by 5pm\".",
      "Fix in DEV, retest, then transport up — never patch straight in the test or production system.",
      "Have the customer re-verify the fix before you close it; you don't close your own defect.",
    ],
    source: "SOP: Defect Management / UAT",
  },
  {
    title: "Getting a functional spec signed off",
    category: "sap",
    summary: "Before build starts on a change, RICEF, or development.",
    steps: [
      "Describe what will be built in the business's language, not only technical detail.",
      "State clearly what is OUT of scope — it prevents the \"but I assumed…\" argument later.",
      "Walk it through with the business owner live; don't just email it and assume agreement.",
      "Get explicit written approval BEFORE development starts.",
      "Any change to a signed spec is a change request — reprice and re-plan, don't just absorb it.",
    ],
    source: "SOP: Requirements & Specifications",
  },
  {
    title: "A data migration load has errors",
    category: "sap",
    summary: "Records fail or look wrong during a migration load.",
    steps: [
      "Quantify it first: how many records, which objects, and is it blocking or a tail of exceptions?",
      "Trace the cause — mapping, source data quality, or the load program itself?",
      "Fix at the right layer: clean the source or the mapping, don't hand-edit records in the target.",
      "After reload, reconcile counts and a data sample WITH the customer's data owner.",
      "Keep the error log — the customer will ask \"can we trust this data?\" and you must be able to answer.",
    ],
    source: "SOP: Data Migration",
  },

  // ---- Budget & billing ----
  {
    title: "A fixed-price project is heading over budget",
    category: "commercial",
    summary: "Effort is trending past what was sold.",
    steps: [
      "Face the numbers early: hours spent vs earned, plus an honest estimate-to-complete.",
      "Separate the cause: our estimate, our efficiency, or customer-driven scope?",
      "Anything customer-driven becomes a change request — don't quietly absorb it into margin.",
      "Bring options to your delivery lead: re-scope, phase it, or open a commercial conversation.",
      "Never rescue a margin by silently cutting testing or quality — that debt comes back bigger.",
    ],
    source: "SOP: Project Financials",
  },
  {
    title: "Estimating effort for a new request",
    category: "commercial",
    summary: "The customer asks \"how much for this?\"",
    steps: [
      "Understand the real requirement first — ask what problem they're solving, not just the ask.",
      "Break it down: analysis, build, test, and a buffer for the unknowns.",
      "Write down the assumptions and dependencies the estimate depends on.",
      "Give a range with a confidence level, not a single hero number you'll be held to.",
      "Route it through the proper change-request/quote flow before you commit a price or a date.",
    ],
    source: "SOP: Estimation & Change Requests",
  },
  {
    title: "A milestone invoice is being disputed",
    category: "commercial",
    summary: "The customer questions or withholds a payment.",
    steps: [
      "Don't get defensive — find out exactly what they're disputing, line by line.",
      "Pull the evidence: signed milestone / UAT sign-off, approved hours, and the status trail.",
      "Separate a genuine delivery gap from a paperwork gap and fix the right one.",
      "Bring in finance and your lead early — a payment issue isn't yours to carry alone.",
      "Agree a concrete resolution and confirm it in writing.",
    ],
    source: "SOP: Billing & Milestones",
  },

  // ---- Team & people ----
  {
    title: "A key consultant becomes unavailable mid-project",
    category: "team",
    summary: "Illness, resignation, or reassignment of someone critical.",
    steps: [
      "Assess the real impact: what only they know, and what's at risk this week vs later.",
      "Protect the knowledge now — capture notes, handover, and access before they're gone.",
      "Tell your delivery lead immediately; resourcing is a shared problem, not a solo scramble.",
      "If the customer is affected, give them a managed message — that beats a surprise later.",
      "Re-plan around the gap honestly instead of hoping to invisibly catch up.",
    ],
    source: "SOP: Resourcing & Continuity",
  },
  {
    title: "Onboarding a consultant onto a live project",
    category: "team",
    summary: "Someone joins a project already in flight.",
    steps: [
      "Give them the essentials on day one: scope, plan, system access, and who's who.",
      "Point them at the key docs (spec, status, RAID) instead of making them dig.",
      "Pair them with someone for the first days — don't drop them in cold.",
      "Give a small, real first task so they build context and confidence quickly.",
      "Check in at the end of week one and clear any access or blocker issues fast.",
    ],
    source: "SOP: Onboarding",
  },
  {
    title: "Running an effective weekly team sync",
    category: "team",
    summary: "Keeping the delivery team aligned each week.",
    steps: [
      "Keep it short and about blockers — not status theatre for its own sake.",
      "Each person covers three things: done, next, blocked.",
      "Capture actions with an owner and a date, and review last week's before adding new ones.",
      "Take any deep-dive offline with just the people involved.",
      "End the meeting knowing the top risk for the week and who owns it.",
    ],
    source: "SOP: Team Management",
  },
];
