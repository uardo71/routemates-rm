"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FileTextIcon, FileSpreadsheetIcon, FileArchiveIcon, MailIcon, ImageIcon, FileIcon, PresentationIcon,
  UploadIcon, Trash2Icon, MessageSquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { attachmentError, fileExtension } from "@/lib/file-types";
import { CR_STAGES, CR_STAGE_KEYS, type CrStageKey } from "@/lib/change-request";
import { uploadTicketFilesAction, setAttachmentStageAction } from "../cr-actions";
import { deleteTicketAttachmentAction } from "../actions";

// Every file on the ticket in one list — added here or posted in the discussion. Any file type is
// accepted except programs and scripts. On a change request, files are filed under the lifecycle
// stage they belong to (spec under Evaluation, test evidence under Unit testing, sign-off under UAT).

export type TicketFile = {
  id: string; url: string; name: string; mime: string; size: number;
  uploadedByName: string; uploadedAt: string; stageKey: string | null;
  fromComment: boolean; internal: boolean; canDelete: boolean;
};

const FILEABLE = CR_STAGE_KEYS.filter((k) => k !== "closed" && k !== "rejected");

function iconFor(name: string, mime: string) {
  const ext = fileExtension(name);
  if (mime.startsWith("image/")) return ImageIcon;
  if ([".xlsx", ".xls", ".xlsm", ".csv", ".ods"].includes(ext)) return FileSpreadsheetIcon;
  if ([".zip", ".7z", ".rar", ".gz", ".tar"].includes(ext)) return FileArchiveIcon;
  if ([".msg", ".eml"].includes(ext)) return MailIcon;
  if ([".pptx", ".ppt"].includes(ext)) return PresentationIcon;
  if ([".pdf", ".docx", ".doc", ".txt", ".md", ".rtf", ".odt"].includes(ext)) return FileTextIcon;
  return FileIcon;
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function TicketFiles({ ticketId, files, canUpload, crStage }: {
  ticketId: string; files: TicketFile[]; canUpload: boolean;
  /** The change request's stage; undefined when the ticket isn't a change request. */
  crStage?: CrStageKey | null;
}) {
  const isCr = crStage !== undefined;
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [stage, setStage] = React.useState<string>(crStage && (FILEABLE as string[]).includes(crStage) ? crStage : "");
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);

  const run = (fn: () => Promise<{ error?: string }>) => start(async () => {
    const r = await fn();
    if (r.error) setErr(r.error); else { setErr(null); router.refresh(); }
  });
  function upload(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    const invalid = attachmentError(arr, 10);
    if (invalid) { setErr(invalid); return; }
    const fd = new FormData();
    arr.forEach((f) => fd.append("files", f));
    if (isCr && stage) fd.set("stageKey", stage);
    run(() => uploadTicketFilesAction(ticketId, fd));
  }

  const groups = isCr
    ? [
        ...CR_STAGE_KEYS.map((k) => ({ key: k as string, label: CR_STAGES[k].label, items: files.filter((f) => f.stageKey === k) })),
        { key: "", label: "Not filed under a stage", items: files.filter((f) => !f.stageKey) },
      ].filter((g) => g.items.length > 0)
    : [{ key: "", label: "", items: files }];

  return (
    <div className="flex flex-col gap-3">
      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={cn("flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2", drag && "border-primary bg-primary/5")}
        >
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={() => inputRef.current?.click()}>
            <UploadIcon className="size-4" /> {pending ? "Uploading…" : "Add files"}
          </Button>
          {isCr && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              File under
              <select value={stage} onChange={(e) => setStage(e.target.value)} className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground">
                <option value="">No stage</option>
                {FILEABLE.map((k) => <option key={k} value={k}>{CR_STAGES[k].label}</option>)}
              </select>
            </label>
          )}
          <span className="text-xs text-muted-foreground">or drop them here · any document, e-mail, spreadsheet or archive, up to 25MB each</span>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : groups.map((g) => (
        <div key={g.key || "none"} className="flex flex-col gap-1">
          {isCr && <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.label} <span className="tabular-nums">({g.items.length})</span></div>}
          <ul className="flex flex-col divide-y rounded-md border">
            {g.items.map((f) => {
              const Icon = iconFor(f.name, f.mime);
              return (
                <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={f.name}>{f.name}</a>
                  {f.fromComment && (
                    <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-[11px]", f.internal ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} title={f.internal ? "Posted in an internal note" : "Posted in the discussion"}>
                      <MessageSquareIcon className="size-3" />{f.internal ? "internal" : ""}
                    </span>
                  )}
                  <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{f.uploadedByName} · {f.uploadedAt.slice(0, 10)}</span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtBytes(f.size)}</span>
                  {isCr && f.canDelete && (
                    <select aria-label={`Stage for ${f.name}`} value={f.stageKey ?? ""} disabled={pending} onChange={(e) => run(() => setAttachmentStageAction(f.id, e.target.value || null))} className="h-7 w-28 shrink-0 rounded-md border bg-background px-1 text-xs">
                      <option value="">No stage</option>
                      {FILEABLE.map((k) => <option key={k} value={k}>{CR_STAGES[k].label}</option>)}
                    </select>
                  )}
                  {f.canDelete && (
                    <button type="button" aria-label={`Delete ${f.name}`} disabled={pending} onClick={() => { if (confirm(`Delete "${f.name}"?`)) run(() => deleteTicketAttachmentAction(f.id)); }} className="shrink-0 text-muted-foreground/50 hover:text-destructive">
                      <Trash2Icon className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
