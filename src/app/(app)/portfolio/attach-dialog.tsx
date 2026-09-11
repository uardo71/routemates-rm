"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileIcon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { attachmentError } from "@/lib/file-types";
import type { WorkspaceRow } from "@/lib/delivery-day";
import { uploadDeliveryDocumentAction } from "../delivery/actions";
import { KINDS } from "../delivery/[projectId]/documents-client";

// Attach files to a workspace straight from the Portfolio — a project plan by default, any file type.
// They land in that workspace's Documents library (the project, or the end customer's stream).

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachDialog({ w, onClose }: { w: WorkspaceRow; onClose: () => void }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [kind, setKind] = React.useState("PROJECT_PLAN");
  const [files, setFiles] = React.useState<File[]>([]);
  const [drag, setDrag] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const add = (list: FileList | null) => { if (list) { setFiles((f) => [...f, ...Array.from(list)]); setErr(null); } };

  function submit() {
    const invalid = attachmentError(files, 10);
    if (invalid) { setErr(invalid); return; }
    const fd = new FormData();
    fd.append("kind", kind);
    files.forEach((f) => fd.append("files", f));
    if (w.engagementId) fd.append("engagementId", w.engagementId);
    start(async () => {
      const r = await uploadDeliveryDocumentAction(w.projectId, fd);
      if (r.error) { setErr(r.error); return; }
      toast.success(`${r.count === 1 ? "File" : `${r.count} files`} attached to ${w.name}.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach to {w.name}</DialogTitle>
          <p className="text-sm text-muted-foreground">{w.isEngagement && w.account ? `${w.customerName} · ${w.account}` : w.customerName} — saved in the workspace&apos;s Documents library.</p>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="att-kind">Type</Label>
            <select id="att-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            className={cn("flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center", drag && "border-primary bg-primary/5")}
          >
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => inputRef.current?.click()}><UploadIcon className="size-4" /> Choose files</Button>
            <span className="text-xs text-muted-foreground">or drop them here · any file — MS Project (.mpp), Primavera, Excel, PDF, PowerPoint, e-mail, archives — up to 25MB each</span>
          </div>
          {files.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {files.map((f, i) => (
                <li key={`${f.name}:${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtBytes(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><XIcon className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={pending || files.length === 0}>{pending ? "Uploading…" : files.length > 1 ? `Attach ${files.length} files` : "Attach"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
