"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon, PlusIcon, SearchIcon, Undo2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  saveTimeGridAction,
  submitTimeCardsAction,
  recallTimeCardAction,
  deleteTimeCardsAction,
  type TimeGridCell,
} from "./actions";

export type TaskOption = { id: string; name: string; estimatedHours: number | null; usedHours: number };
export type AssignmentOption = {
  id: string;
  projectName: string;
  milestoneName: string;
  allocatedHours: number | null;
  usedHours: number;
  pickable: boolean;
  tasks: TaskOption[];
};
export type CardStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type GridCard = {
  id: string;
  assignmentId: string;
  status: CardStatus;
  approverName: string | null;
  comment: string | null;
  entries: { taskId: string | null; date: string; hours: number; description: string }[];
};

type AssignmentPickerOption = { assignmentId: string; label: string; cap: number | null; used: number };
type TaskPickerOption = { taskId: string; label: string; cap: number | null; used: number };

const NOTE_MAX_LENGTH = 255;
const NEW_PREFIX = "new:";

const STATUS_TONE: Record<CardStatus, "secondary" | "default" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

function AssignmentPicker({ options, onSelect }: { options: AssignmentPickerOption[]; onSelect: (o: AssignmentPickerOption) => void }) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  const filtered = useMemo(
    () =>
      trimmed.length < 3
        ? []
        : options.filter((o) => o.label.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 50),
    [options, trimmed]
  );

  const browseTrimmed = browseQuery.trim();
  const browseFiltered = useMemo(
    () =>
      (browseTrimmed.length === 0
        ? options
        : options.filter((o) => o.label.toLowerCase().includes(browseTrimmed.toLowerCase()))
      ).slice(0, 200),
    [options, browseTrimmed]
  );

  function positionDropdown() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  function select(o: AssignmentPickerOption) {
    onSelect(o);
    setQuery("");
    setDropdownOpen(false);
    setBrowseOpen(false);
  }

  return (
    <>
      <div className="flex w-full max-w-md items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setBrowseQuery("");
            setBrowseOpen(true);
          }}
          className="flex h-9 shrink-0 items-center justify-center rounded-md border border-input bg-background px-2 text-muted-foreground hover:bg-muted"
          aria-label="Browse all valid assignments"
          title="Browse all valid assignments"
        >
          <SearchIcon className="size-4" />
        </button>
        <Input
          ref={inputRef}
          value={query}
          placeholder="Type project / milestone…"
          className="h-9"
          onChange={(e) => {
            setQuery(e.target.value);
            positionDropdown();
            setDropdownOpen(true);
          }}
          onFocus={() => {
            positionDropdown();
            setDropdownOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on a dropdown option (which prevents default on mousedown) still registers.
            setTimeout(() => setDropdownOpen(false), 150);
          }}
        />
      </div>

      {dropdownOpen &&
        trimmed.length > 0 &&
        dropdownRect &&
        createPortal(
          <div
            style={{ position: "fixed", top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
            className="z-50 max-h-72 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            {trimmed.length < 3 && (
              <div className="p-3 text-sm text-muted-foreground">Type at least 3 characters to search.</div>
            )}
            {trimmed.length >= 3 && filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No matches.</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.assignmentId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(o)}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                {o.label}
                {o.cap !== null && <span className="ml-2 text-xs text-muted-foreground">{o.used}h / {o.cap}h cap</span>}
              </button>
            ))}
          </div>,
          document.body
        )}

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>All valid assignments</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Filter…"
            value={browseQuery}
            onChange={(e) => setBrowseQuery(e.target.value)}
          />
          <div className="max-h-72 overflow-auto rounded-md border">
            {browseFiltered.length === 0 && <div className="p-3 text-sm text-muted-foreground">No matches.</div>}
            {browseFiltered.map((o) => (
              <button
                key={o.assignmentId}
                type="button"
                onClick={() => select(o)}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                {o.label}
                {o.cap !== null && <span className="ml-2 text-xs text-muted-foreground">{o.used}h / {o.cap}h cap</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskPicker({ options, onSelect }: { options: TaskPickerOption[]; onSelect: (o: TaskPickerOption) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <PlusIcon className="size-3.5" /> Add task
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick a task</DialogTitle>
          </DialogHeader>
          <Input autoFocus placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-72 overflow-auto rounded-md border">
            {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground">No matching tasks.</div>}
            {filtered.map((o) => (
              <button
                key={o.taskId}
                type="button"
                onClick={() => {
                  onSelect(o);
                  setOpen(false);
                }}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                {o.label}
                {o.cap !== null && <span className="ml-2 text-xs text-muted-foreground">{o.used}h / {o.cap}h cap</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type NewLine = { localId: string; assignmentId: string | null };
// cardKey identifies which not-yet-saved line a task entry belongs to — an assignment can have
// several such lines open at once (e.g. "Copy from previous week" replicating two prior-week
// cards for the same assignment), so grouping by assignmentId alone isn't enough.
type NewTaskEntry = { cardKey: string; assignmentId: string; taskId: string | null };
type EmptyGroup = { cardKey: string; assignmentId: string };

function cellKey(cardKey: string, taskId: string | null): string {
  return `${cardKey}::${taskId ?? "_"}`;
}

export function WeekGrid({
  targetUserId,
  weekStart,
  assignments,
  cards,
  previousWeekCards,
  isOwnWeek,
}: {
  targetUserId: string;
  weekStart: string;
  assignments: AssignmentOption[];
  cards: GridCard[];
  previousWeekCards: GridCard[];
  isOwnWeek: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingCardKey, setPendingCardKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Task sub-rows are collapsed by default — only the assignment/card header shows until expanded.
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  function toggleExpanded(cardKey: string) {
    setExpandedCards((prev) => ({ ...prev, [cardKey]: !prev[cardKey] }));
  }
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart), i)), [weekStart]);

  const assignmentMap = useMemo(() => new Map(assignments.map((a) => [a.id, a])), [assignments]);

  // Top-level search only ever resolves an assignment — never a specific task. Milestones with
  // tasks get a group header plus an explicit "+ Add task" control instead of jumping straight
  // to one task, so the user picks each task deliberately rather than it happening implicitly.
  const pickerOptions = useMemo<AssignmentPickerOption[]>(
    () =>
      assignments
        .filter((a) => a.pickable)
        .map((a) => ({
          assignmentId: a.id,
          label: `${a.projectName} — ${a.milestoneName}`,
          cap: a.allocatedHours,
          used: a.usedHours,
        })),
    [assignments]
  );

  // localId only ever backs a React `key` / local lookup, never rendered DOM content, so generating it
  // in the lazy initializer (which also runs during SSR) can't cause a hydration mismatch.
  const [newLines, setNewLines] = useState<NewLine[]>(() =>
    Array.from({ length: 3 }, () => ({ localId: crypto.randomUUID(), assignmentId: null }))
  );
  // Lines opened (via search) that don't have a task added yet — shown as a header with just
  // "+ Add task" so picking the assignment never implies a task.
  const [emptyGroups, setEmptyGroups] = useState<EmptyGroup[]>([]);
  // Tasks added to a not-yet-saved card, identified by that card's cardKey — a task here is only
  // ever an hours sub-row, status/submit/delete live on the whole card.
  const [newTaskEntries, setNewTaskEntries] = useState<NewTaskEntry[]>([]);

  const initialHours = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const c of cards) {
      for (const e of c.entries) {
        const key = cellKey(c.id, e.taskId);
        map[key] ??= {};
        map[key][e.date] = e.hours;
      }
    }
    return map;
  }, [cards]);

  const initialNotes = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const c of cards) {
      for (const e of c.entries) {
        if (!e.description) continue;
        const key = cellKey(c.id, e.taskId);
        map[key] ??= {};
        map[key][e.date] = e.description;
      }
    }
    return map;
  }, [cards]);

  const [hours, setHours] = useState(initialHours);
  const [notes, setNotes] = useState(initialNotes);
  // Notes are entered once per assignment card (shared across all of its task rows for a given
  // day), not per task — `keys` lists every cell key that should receive the same text.
  const [noteEditor, setNoteEditor] = useState<{ keys: string[]; date?: string; readOnly: boolean } | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  function cellValue(key: string, date: string): number {
    return hours[key]?.[date] ?? 0;
  }
  function setCellValue(key: string, date: string, value: number) {
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], [date]: value } }));
  }
  function cellNote(key: string, date: string): string {
    return notes[key]?.[date] ?? "";
  }
  function setCellNote(key: string, date: string, value: string) {
    setNotes((prev) => ({ ...prev, [key]: { ...prev[key], [date]: value } }));
  }

  function labelFor(assignmentId: string, taskId: string | null): { project: string; milestone: string; task: string | null; cap: number | null; used: number } {
    const a = assignmentMap.get(assignmentId);
    if (!a) return { project: "Unknown", milestone: "", task: null, cap: null, used: 0 };
    if (taskId) {
      const t = a.tasks.find((x) => x.id === taskId);
      return { project: a.projectName, milestone: a.milestoneName, task: t?.name ?? "Unknown task", cap: t?.estimatedHours ?? null, used: t?.usedHours ?? 0 };
    }
    return { project: a.projectName, milestone: a.milestoneName, task: null, cap: a.allocatedHours, used: a.usedHours };
  }

  function removeNewLine(localId: string) {
    setNewLines((prev) => prev.filter((l) => l.localId !== localId));
  }
  function addLine() {
    setNewLines((prev) => [...prev, { localId: crypto.randomUUID(), assignmentId: null }]);
  }
  // Reuse the cardKey of an assignment's currently-open not-yet-saved line, if one exists, so
  // repeated interactions (re-picking the same assignment, adding another task) land on the same
  // card instead of spawning duplicates. Returns null if no such line is open yet.
  function findOpenNewCardKey(assignmentId: string): string | null {
    return (
      emptyGroups.find((g) => g.assignmentId === assignmentId)?.cardKey ??
      newTaskEntries.find((t) => t.assignmentId === assignmentId)?.cardKey ??
      null
    );
  }

  function resolveNewLine(localId: string, option: AssignmentPickerOption) {
    removeNewLine(localId);
    const a = assignmentMap.get(option.assignmentId);
    const cardKey = findOpenNewCardKey(option.assignmentId) ?? NEW_PREFIX + crypto.randomUUID();
    if (a && a.tasks.length > 0) {
      setEmptyGroups((prev) => (prev.some((g) => g.cardKey === cardKey) ? prev : [...prev, { cardKey, assignmentId: option.assignmentId }]));
      // A group the user just opened should show its (empty) task list immediately, not require
      // an extra expand click right after they picked it.
      setExpandedCards((prev) => ({ ...prev, [cardKey]: true }));
    } else {
      setNewTaskEntries((prev) =>
        prev.some((t) => t.cardKey === cardKey && t.taskId === null)
          ? prev
          : [...prev, { cardKey, assignmentId: option.assignmentId, taskId: null }]
      );
    }
  }

  // cardKey is the exact card the "+ Add task" control was opened from — a brand-new not-yet-saved
  // line, or an existing still-editable (DRAFT/REJECTED) persisted card. Either way the task lands
  // on that same card, never a separate one.
  function addTaskToAssignment(cardKey: string, assignmentId: string, task: TaskPickerOption) {
    // Notes are shared across a whole card's task rows, not entered per task — backfill this new
    // task from an existing sibling in the same card so it starts in sync with the rest.
    const sibling = newTaskEntries.find((t) => t.cardKey === cardKey);
    const siblingNotes = sibling ? notes[cellKey(cardKey, sibling.taskId)] : undefined;
    if (siblingNotes) {
      setNotes((prev) => ({ ...prev, [cellKey(cardKey, task.taskId)]: { ...siblingNotes } }));
    }
    setNewTaskEntries((prev) => [...prev, { cardKey, assignmentId, taskId: task.taskId }]);
  }
  function removeNewTask(cardKey: string, taskId: string | null) {
    const assignmentId = resolvedCards.find((c) => c.cardKey === cardKey)?.assignmentId;
    setNewTaskEntries((prev) => prev.filter((t) => !(t.cardKey === cardKey && t.taskId === taskId)));
    // Keep the header open (with "Add task") rather than having it vanish out from under the user.
    if (assignmentId) {
      setEmptyGroups((prev) => (prev.some((g) => g.cardKey === cardKey) ? prev : [...prev, { cardKey, assignmentId }]));
    }
  }
  function removeNewCard(cardKey: string) {
    setEmptyGroups((prev) => prev.filter((g) => g.cardKey !== cardKey));
    setNewTaskEntries((prev) => prev.filter((t) => t.cardKey !== cardKey));
  }

  type ResolvedCard = {
    cardKey: string;
    assignmentId: string;
    status: CardStatus | null;
    approverName: string | null;
    comment: string | null;
    locked: boolean;
    removable: boolean;
    taskIds: (string | null)[];
  };

  const resolvedCards: ResolvedCard[] = cards.map((c): ResolvedCard => ({
    cardKey: c.id,
    assignmentId: c.assignmentId,
    status: c.status,
    approverName: c.approverName,
    comment: c.comment,
    locked: c.status === "SUBMITTED" || c.status === "APPROVED",
    removable: false,
    taskIds: [...new Set(c.entries.map((e) => e.taskId))],
  }));
  {
    const resolvedByKey = new Map(resolvedCards.map((c) => [c.cardKey, c]));
    const newGroups = new Map<string, { assignmentId: string; taskIds: (string | null)[] }>();
    for (const g of emptyGroups) {
      if (!newGroups.has(g.cardKey)) newGroups.set(g.cardKey, { assignmentId: g.assignmentId, taskIds: [] });
    }
    for (const t of newTaskEntries) {
      if (!newGroups.has(t.cardKey)) newGroups.set(t.cardKey, { assignmentId: t.assignmentId, taskIds: [] });
      const group = newGroups.get(t.cardKey)!;
      if (!group.taskIds.includes(t.taskId)) group.taskIds.push(t.taskId);
    }
    for (const [cardKey, group] of newGroups) {
      const existing = resolvedByKey.get(cardKey);
      if (existing) {
        // A task added via "+ Add task" on an already-persisted (still-editable) card merges into
        // that same card, rather than spawning a separate new line.
        existing.taskIds = [...new Set([...existing.taskIds, ...group.taskIds])];
      } else {
        resolvedCards.push({
          cardKey,
          assignmentId: group.assignmentId,
          status: null,
          approverName: null,
          comment: null,
          locked: false,
          removable: true,
          taskIds: group.taskIds,
        });
      }
    }
  }

  function cardSumForDay(card: ResolvedCard, date: string): number {
    return card.taskIds.reduce((sum, taskId) => sum + cellValue(cellKey(card.cardKey, taskId), date), 0);
  }
  function cardTotalSum(card: ResolvedCard): number {
    return days.reduce((sum, d) => sum + cardSumForDay(card, format(d, "yyyy-MM-dd")), 0);
  }

  function daySum(date: string): number {
    return resolvedCards.reduce((sum, c) => sum + cardSumForDay(c, date), 0);
  }
  const grandTotal = days.reduce((sum, d) => sum + daySum(format(d, "yyyy-MM-dd")), 0);

  function copyFromPreviousWeek() {
    const hourMap: Record<string, Record<string, number>> = {};
    const toAdd: NewTaskEntry[] = [];
    const skipped = new Set<string>();
    // One destination cardKey per SOURCE card (not per assignment) — a prior week can hold several
    // cards for the same assignment (e.g. a locked original plus a correction line), and each must
    // land as its own separate line here too, or their overlapping tasks would silently clobber
    // each other under one shared key.
    const sourceCardKeys: Record<string, string> = {};
    for (const c of previousWeekCards) {
      const a = assignmentMap.get(c.assignmentId);
      // `pickable` already reflects whether this assignment is ACTIVE, its milestone is open for
      // time entry, and its date window covers the week being viewed — i.e. exactly "still valid
      // to log time against this week". Skip copying anything that no longer qualifies rather than
      // silently creating a line that Save would reject anyway.
      if (!a || !a.pickable) {
        skipped.add(a ? `${a.projectName} — ${a.milestoneName}` : "an assignment");
        continue;
      }
      for (const e of c.entries) {
        const already = resolvedCards.find((rc) => rc.assignmentId === c.assignmentId && rc.taskIds.includes(e.taskId));
        let cardKey: string;
        if (already) {
          cardKey = already.cardKey;
        } else {
          cardKey = sourceCardKeys[c.id] ?? NEW_PREFIX + crypto.randomUUID();
          sourceCardKeys[c.id] = cardKey;
        }
        if (!already && !toAdd.some((t) => t.cardKey === cardKey && t.taskId === e.taskId)) {
          toAdd.push({ cardKey, assignmentId: c.assignmentId, taskId: e.taskId });
        }
        const key = cellKey(cardKey, e.taskId);
        const newDate = format(addDays(new Date(e.date), 7), "yyyy-MM-dd");
        hourMap[key] ??= {};
        hourMap[key][newDate] = e.hours;
      }
    }
    if (toAdd.length > 0) setNewTaskEntries((prev) => [...prev, ...toAdd]);
    if (Object.keys(hourMap).length > 0) setHours((prev) => ({ ...prev, ...hourMap }));
    if (skipped.size > 0) {
      toast.warning(`Skipped (no longer valid this week): ${[...skipped].join(", ")}`);
    }
    if (Object.keys(hourMap).length > 0) {
      toast.success("Copied last week's hours — remember to Save.");
    } else if (skipped.size === 0) {
      toast.error("Nothing to copy from last week.");
    }
  }

  // Notes are meant to be shared across every task row on a card for a given day, but the
  // underlying data is still one independent `description` per TimeEntry — a task that simply
  // has no hours (and so no entry) on that particular day trivially has no note recorded either.
  // Always reading from `keys[0]` broke as soon as that happened to be such a task: the editor
  // would show blank, and saving it would have overwritten the real note the other tasks do have.
  // Pick the first key that actually has text for the day instead of blindly using index 0.
  function existingNoteFor(keys: string[], date: string): string {
    for (const key of keys) {
      const value = cellNote(key, date);
      if (value.trim()) return value;
    }
    return "";
  }

  function openNoteEditor(keys: string[], readOnly: boolean, date?: string) {
    if (date) {
      setNoteDraft({ [date]: existingNoteFor(keys, date) });
    } else {
      const draft: Record<string, string> = {};
      for (const d of days) {
        const dateStr = format(d, "yyyy-MM-dd");
        draft[dateStr] = existingNoteFor(keys, dateStr);
      }
      setNoteDraft(draft);
    }
    setNoteEditor({ keys, date, readOnly });
  }
  function saveNoteEditor() {
    if (!noteEditor) return;
    for (const [date, value] of Object.entries(noteDraft)) {
      for (const key of noteEditor.keys) {
        setCellNote(key, date, value.slice(0, NOTE_MAX_LENGTH));
      }
    }
    setNoteEditor(null);
  }

  function handleSave() {
    const cells: TimeGridCell[] = [];
    const missingNotes = new Set<string>();
    const mixedSignLines = new Set<string>();
    for (const card of resolvedCards) {
      if (card.locked) continue;
      const label = labelFor(card.assignmentId, null);
      let hasPositive = false;
      let hasNegative = false;
      for (const taskId of card.taskIds) {
        const key = cellKey(card.cardKey, taskId);
        for (const d of days) {
          const date = format(d, "yyyy-MM-dd");
          const h = cellValue(key, date);
          const note = cellNote(key, date);
          if (h > 0) hasPositive = true;
          if (h < 0) hasNegative = true;
          if (h !== 0 && !note.trim()) {
            // Notes are entered once per assignment card per day — dedupe by card so a missing
            // note on a shared day doesn't produce one message per task row.
            missingNotes.add(`${label.project} — ${label.milestone} — ${format(d, "EEE M/d")}`);
          }
          cells.push({ lineId: card.cardKey, assignmentId: card.assignmentId, taskId, date, hours: h, description: note });
        }
      }
      // A line is either logged work (positive) or a correction undoing previously approved hours
      // (negative) — never both at once, so a correction's auto-approval-on-submit can trust the
      // line's sign alone rather than needing to net the cells first.
      if (hasPositive && hasNegative) {
        mixedSignLines.add(`${label.project} — ${label.milestone}`);
      }
    }
    if (mixedSignLines.size > 0) {
      toast.error(
        `Cannot mix positive and negative hours on the same line: ${[...mixedSignLines].join(", ")}. Use a separate line for the correction.`
      );
      return;
    }
    if (missingNotes.size > 0) {
      const list = [...missingNotes];
      toast.error(`A note is required for: ${list.slice(0, 3).join(", ")}${list.length > 3 ? "…" : ""}`);
      return;
    }
    if (cells.length === 0) {
      toast.error("Nothing to save yet — pick a project first.");
      return;
    }
    startTransition(async () => {
      const result = await saveTimeGridAction({ targetUserId, weekStartDate: weekStart, cells });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Saved.");
        setNewLines(Array.from({ length: 3 }, () => ({ localId: crypto.randomUUID(), assignmentId: null })));
        setNewTaskEntries([]);
        setEmptyGroups([]);
        router.refresh();
      }
    });
  }

  // A negative-only total is a valid correction line (undoing previously approved hours), not an
  // empty one — only an exact-zero total (nothing logged, or a fully-cancelled-out line) is not
  // submittable.
  const submittableCards = resolvedCards.filter((c) => (c.status === "DRAFT" || c.status === "REJECTED") && cardTotalSum(c) !== 0);

  function toggleSelected(cardKey: string) {
    setSelected((prev) => ({ ...prev, [cardKey]: !prev[cardKey] }));
  }

  function handleSubmitSelected() {
    const checked = submittableCards.filter((c) => selected[c.cardKey]);
    let targets = checked;
    if (checked.length === 0) {
      if (submittableCards.length === 0) {
        toast.error("Nothing to submit — save some hours first.");
        return;
      }
      if (!confirm(`No lines selected — submit all ${submittableCards.length} draft line(s) for this week?`)) {
        return;
      }
      targets = submittableCards;
    }
    startTransition(async () => {
      const result = await submitTimeCardsAction(targets.map((c) => c.cardKey));
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Submitted for approval.");
        setSelected({});
        router.refresh();
      }
    });
  }

  function handleDeleteSelected() {
    const checked = resolvedCards.filter((c) => selected[c.cardKey] && c.status !== null);
    if (checked.length === 0) {
      toast.error("Select at least one draft line to delete.");
      return;
    }
    const notDraft = checked.filter((c) => c.status !== "DRAFT");
    if (notDraft.length > 0) {
      toast.error("Only draft lines can be deleted — deselect any submitted, approved, or rejected lines.");
      return;
    }
    if (!confirm(`Delete ${checked.length} draft line(s)? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteTimeCardsAction(checked.map((c) => c.cardKey));
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Deleted.");
        setSelected({});
        router.refresh();
      }
    });
  }

  function handleRecallCard(cardKey: string) {
    setPendingCardKey(cardKey);
    startTransition(async () => {
      try {
        await recallTimeCardAction(cardKey);
        toast.success("Recalled to draft.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to recall.");
      } finally {
        setPendingCardKey(null);
      }
    });
  }

  function renderStatusCell(card: ResolvedCard) {
    if (card.status === null) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant={STATUS_TONE[card.status]}>{card.status}</Badge>
        {card.status === "SUBMITTED" && isOwnWeek && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => handleRecallCard(card.cardKey)} disabled={pending && pendingCardKey === card.cardKey}>
            <Undo2Icon className="size-3" /> Recall
          </Button>
        )}
        {card.status === "REJECTED" && card.comment && (
          <span className="text-[11px] text-muted-foreground" title={card.comment}>
            &quot;{card.comment}&quot;
          </span>
        )}
        {card.status === "APPROVED" && card.approverName && (
          <span className="text-[11px] text-muted-foreground">by {card.approverName}</span>
        )}
      </div>
    );
  }

  function renderTaskRow(card: ResolvedCard, taskId: string | null, noteKeys: string[]) {
    const key = cellKey(card.cardKey, taskId);
    const label = labelFor(card.assignmentId, taskId);
    const sum = days.reduce((s, d) => s + cellValue(key, format(d, "yyyy-MM-dd")), 0);
    const over = label.cap !== null && label.used + sum > label.cap;
    return (
      <tr key={key} className="border-t">
        <td className="p-2" />
        <td className="p-2 pl-8">
          <div className="flex items-start gap-1.5">
            {card.removable && (
              <button
                type="button"
                onClick={() => removeNewTask(card.cardKey, taskId)}
                className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                aria-label="Remove task"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
            <div>
              <div className="font-medium">{label.task ?? "Unknown task"}</div>
              {label.cap !== null && (
                <div className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
                  {label.used}h approved / {label.cap}h cap
                </div>
              )}
            </div>
          </div>
        </td>
        {days.map((d) => {
          const date = format(d, "yyyy-MM-dd");
          const val = cellValue(key, date);
          return (
            <td key={date} className="p-1 border-l relative">
              {card.locked ? (
                <div className="text-center tabular-nums">{val || "—"}</div>
              ) : (
                <Input
                  type="number"
                  step="0.25"
                  className="h-8 text-center"
                  value={val || ""}
                  onChange={(e) => setCellValue(key, date, Number(e.target.value) || 0)}
                  onDoubleClick={() => openNoteEditor(noteKeys, false, date)}
                  title="Double-click to add a note for this day"
                />
              )}
            </td>
          );
        })}
        <td className="p-1.5 text-center font-medium tabular-nums border-l">{sum || "—"}</td>
        <td className="border-l" />
        <td className="border-l" />
      </tr>
    );
  }

  function renderLeafCard(card: ResolvedCard) {
    // No tasks on this milestone — the assignment itself is the only row, status/checkbox/notes
    // live on it directly.
    const taskId = card.taskIds[0] ?? null;
    const key = cellKey(card.cardKey, taskId);
    const label = labelFor(card.assignmentId, taskId);
    const sum = cardTotalSum(card);
    const over = label.cap !== null && label.used + sum > label.cap;
    const submittable = card.status !== null && (card.status === "DRAFT" || card.status === "REJECTED") && sum !== 0;
    return (
      <tr key={card.cardKey} className="border-t">
        <td className="p-2 text-center">
          {submittable && (
            <input
              type="checkbox"
              className="size-4"
              checked={!!selected[card.cardKey]}
              onChange={() => toggleSelected(card.cardKey)}
              aria-label="Select for submission"
            />
          )}
        </td>
        <td className="p-2">
          <div className="flex items-start gap-1.5">
            {card.removable && (
              <button
                type="button"
                onClick={() => removeNewCard(card.cardKey)}
                className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                aria-label="Remove line"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
            <div>
              <div className="font-medium">{label.project} — {label.milestone}</div>
              {label.cap !== null && (
                <div className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
                  {label.used}h approved / {label.cap}h cap
                </div>
              )}
            </div>
          </div>
        </td>
        {days.map((d) => {
          const date = format(d, "yyyy-MM-dd");
          const val = cellValue(key, date);
          const hasNote = cellNote(key, date).trim().length > 0;
          return (
            <td key={date} className="p-1 border-l relative">
              {card.locked ? (
                <div className="text-center tabular-nums">{val || "—"}</div>
              ) : (
                <Input
                  type="number"
                  step="0.25"
                  className="h-8 text-center"
                  value={val || ""}
                  onChange={(e) => setCellValue(key, date, Number(e.target.value) || 0)}
                  onDoubleClick={() => openNoteEditor([key], false, date)}
                  title="Double-click to add a note for this day"
                />
              )}
              {val !== 0 && !hasNote && !card.locked && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive" title="Note required" />
              )}
            </td>
          );
        })}
        <td className="p-1.5 text-center font-medium tabular-nums border-l">{sum || "—"}</td>
        <td className="p-1.5 border-l">{renderStatusCell(card)}</td>
        <td className="p-1 text-center border-l">
          <button
            type="button"
            onClick={() => openNoteEditor([key], card.locked)}
            className="inline-flex items-center justify-center rounded p-1 hover:bg-muted text-muted-foreground"
            aria-label="Notes for each day"
            title="Enter notes for each day"
          >
            <FileTextIcon className="size-4" />
          </button>
        </td>
      </tr>
    );
  }

  function renderCard(card: ResolvedCard) {
    const a = assignmentMap.get(card.assignmentId);
    if (!a) return null;
    if (a.tasks.length === 0) return renderLeafCard(card);

    const headerCells = days.map((d) => cardSumForDay(card, format(d, "yyyy-MM-dd")));
    const headerTotal = headerCells.reduce((s, v) => s + v, 0);
    const noteKeys = card.taskIds.map((taskId) => cellKey(card.cardKey, taskId));
    const submittable = card.status !== null && (card.status === "DRAFT" || card.status === "REJECTED") && headerTotal !== 0;

    const usedTaskIds = new Set(card.taskIds.filter((t): t is string => t !== null));
    const remainingTasks: TaskPickerOption[] = a.tasks
      .filter((t) => !usedTaskIds.has(t.id))
      .map((t) => ({ taskId: t.id, label: t.name, cap: t.estimatedHours, used: t.usedHours }));
    const expanded = !!expandedCards[card.cardKey];

    return (
      <Fragment key={`card-${card.cardKey}`}>
        <tr className="border-t bg-muted/30">
          <td className="p-2 text-center">
            {submittable && (
              <input
                type="checkbox"
                className="size-4"
                checked={!!selected[card.cardKey]}
                onChange={() => toggleSelected(card.cardKey)}
                aria-label="Select for submission"
              />
            )}
          </td>
          <td className="p-2 font-medium">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleExpanded(card.cardKey)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label={expanded ? "Collapse tasks" : "Expand tasks"}
                title={expanded ? "Collapse tasks" : "Expand tasks"}
              >
                {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
              </button>
              {card.removable && (
                <button
                  type="button"
                  onClick={() => removeNewCard(card.cardKey)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
              {a.projectName} — {a.milestoneName}
            </div>
          </td>
          {headerCells.map((v, i) => {
            const date = format(days[i], "yyyy-MM-dd");
            // Check every task's key for this day, not just one — a task with no hours (and so no
            // entry) on this particular day trivially has no note either, which used to produce a
            // false "note required" flag even when another task on the same card genuinely has one.
            const hasNote = noteKeys.some((k) => cellNote(k, date).trim().length > 0);
            return (
              <td key={i} className="p-1.5 text-center tabular-nums border-l text-muted-foreground relative">
                {v || "—"}
                {v !== 0 && !hasNote && !card.locked && (
                  <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive" title="Note required" />
                )}
              </td>
            );
          })}
          <td className="p-1.5 text-center font-medium tabular-nums border-l">{headerTotal || "—"}</td>
          <td className="p-1.5 border-l">{renderStatusCell(card)}</td>
          <td className="p-1 text-center border-l">
            {noteKeys.length > 0 && (
              <button
                type="button"
                onClick={() => openNoteEditor(noteKeys, card.locked)}
                className="inline-flex items-center justify-center rounded p-1 hover:bg-muted text-muted-foreground"
                aria-label="Notes for each day (applies to all tasks in this assignment)"
                title="Notes for each day — shared across all tasks in this assignment"
              >
                <FileTextIcon className="size-4" />
              </button>
            )}
          </td>
        </tr>
        {expanded && card.taskIds.map((taskId) => renderTaskRow(card, taskId, noteKeys))}
        {expanded && !card.locked && remainingTasks.length > 0 && (
          <tr className="border-t">
            <td className="p-1.5" />
            <td className="p-1.5 pl-8" colSpan={days.length + 3}>
              <TaskPicker options={remainingTasks} onSelect={(t) => addTaskToAssignment(card.cardKey, card.assignmentId, t)} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base">Week of {format(new Date(weekStart), "MMM d, yyyy")}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyFromPreviousWeek} disabled={pending}>
            Copy from previous week
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending && !pendingCardKey ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSubmitSelected} disabled={pending}>
            Submit{Object.values(selected).some(Boolean) ? ` (${Object.values(selected).filter(Boolean).length})` : ""}
          </Button>
          {isOwnWeek && (
            <Button size="sm" variant="destructive" onClick={handleDeleteSelected} disabled={pending}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground bg-muted/50">
                <th className="p-2 w-8" />
                <th className="p-2 min-w-72">Project / Assignment</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="p-2 w-16 text-center border-l font-medium">
                    {format(d, "EEE")}
                    <div className="text-[11px] font-normal">{format(d, "M/d")}</div>
                  </th>
                ))}
                <th className="p-2 w-14 text-center border-l">Sum</th>
                <th className="p-2 w-28 text-center border-l">Status</th>
                <th className="p-2 w-16 text-center border-l">Notes</th>
              </tr>
            </thead>
            <tbody>
              {resolvedCards.map((card) => renderCard(card))}
              {newLines
                .filter((l) => l.assignmentId === null)
                .map((l) => (
                  <tr key={l.localId} className="border-t">
                    <td className="p-2" colSpan={days.length + 4}>
                      <div className="flex items-center gap-2">
                        <AssignmentPicker options={pickerOptions} onSelect={(o) => resolveNewLine(l.localId, o)} />
                        <button
                          type="button"
                          onClick={() => removeNewLine(l.localId)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Remove line"
                        >
                          <XIcon className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium bg-muted/30">
                <td className="p-2" colSpan={2}>Total</td>
                {days.map((d) => (
                  <td key={d.toISOString()} className="p-1.5 text-center tabular-nums border-l">
                    {daySum(format(d, "yyyy-MM-dd")) || "—"}
                  </td>
                ))}
                <td className="p-1.5 text-center tabular-nums border-l">{grandTotal || "—"}</td>
                <td className="border-l" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        <Button variant="outline" size="sm" onClick={addLine} className="w-fit">
          <PlusIcon /> Add line
        </Button>

        <p className="text-xs text-muted-foreground">
          Each assignment line has its own status — save hours to create a draft line, then submit it for approval
          whenever you&apos;re ready. Once a line is approved it&apos;s frozen; add a new line against the same
          project to correct it (use a negative number to reduce previously approved hours). Tasks are just hours
          sub-rows within a line — they don&apos;t carry their own status.
        </p>
      </CardContent>

      <Dialog open={noteEditor !== null} onOpenChange={(open) => !open && setNoteEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{noteEditor?.date ? `Note — ${format(new Date(noteEditor.date), "EEEE MMM d")}` : "Daily notes"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {noteEditor?.date
              ? (
                <div className="flex flex-col gap-1">
                  <Textarea
                    value={noteDraft[noteEditor.date] ?? ""}
                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [noteEditor.date!]: e.target.value }))}
                    placeholder="What did you work on?"
                    maxLength={NOTE_MAX_LENGTH}
                    rows={4}
                    autoFocus
                    disabled={noteEditor.readOnly}
                  />
                  <span className="self-end text-xs text-muted-foreground">
                    {(noteDraft[noteEditor.date] ?? "").length}/{NOTE_MAX_LENGTH}
                  </span>
                </div>
              )
              : days.map((d) => {
                  const dateStr = format(d, "yyyy-MM-dd");
                  return (
                    <div key={dateStr} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{format(d, "EEEE M/d")}</span>
                      <Textarea
                        value={noteDraft[dateStr] ?? ""}
                        onChange={(e) => setNoteDraft((prev) => ({ ...prev, [dateStr]: e.target.value }))}
                        placeholder="What did you work on?"
                        maxLength={NOTE_MAX_LENGTH}
                        rows={2}
                        disabled={noteEditor?.readOnly}
                      />
                      <span className="self-end text-xs text-muted-foreground">
                        {(noteDraft[dateStr] ?? "").length}/{NOTE_MAX_LENGTH}
                      </span>
                    </div>
                  );
                })}
          </div>
          <DialogFooter>
            {noteEditor?.readOnly ? (
              <Button size="sm" variant="outline" onClick={() => setNoteEditor(null)}>
                Close
              </Button>
            ) : (
              <Button size="sm" onClick={saveNoteEditor}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
