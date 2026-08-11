"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaperclipIcon, XIcon, UploadIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DocRow = { id: string; kind: string; fileName: string; originalName: string };
type Kind = { value: string; label: string };

// Reusable attachment card for invoices/opportunities. Files are served through the authenticated
// /api/documents route (never a public URL). `uploadAction` is the entity's action with its parent
// id pre-bound (.bind(null, id)); `deleteAction` takes the document id.
export function DocumentsCard({
  title = "Documents",
  documents,
  kinds,
  canManage,
  uploadAction,
  deleteAction,
}: {
  title?: string;
  documents: DocRow[];
  kinds: Kind[];
  canManage: boolean;
  uploadAction: (formData: FormData) => Promise<{ error?: string }>;
  deleteAction: (id: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState(kinds[0]?.value ?? "");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindLabel = (v: string) => kinds.find((k) => k.value === v)?.label ?? v;

  // Long attachment lists (e.g. a per-person SoW/PO batch) get collapsed to a short preview with a
  // "Show all" toggle so the card doesn't dominate the page.
  const COLLAPSE_THRESHOLD = 5;
  const PREVIEW_COUNT = 3;
  const collapsible = documents.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const visible = collapsible && !expanded ? documents.slice(0, PREVIEW_COUNT) : documents;

  function upload() {
    if (!file) return toast.error("Pick a file to upload.");
    if (!kind) return toast.error("Pick a document type.");
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    start(async () => {
      const r = await uploadAction(fd);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Document uploaded.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this document?")) return;
    start(async () => {
      const r = await deleteAction(id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Document deleted.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {title}
          {documents.length > 0 && <span className="ml-1 font-normal text-muted-foreground">({documents.length})</span>}
        </CardTitle>
        {collapsible && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUpIcon className="size-4 mr-1" /> : <ChevronDownIcon className="size-4 mr-1" />}
            {expanded ? "Show less" : `Show all ${documents.length}`}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents attached yet.</p>}
        {visible.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="shrink-0">
              {kindLabel(d.kind)}
            </Badge>
            <a
              href={`/api/documents/${d.fileName}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
              title={d.originalName}
            >
              <PaperclipIcon className="size-3.5 shrink-0" />
              <span className="truncate">{d.originalName}</span>
            </a>
            <div className="flex-1" />
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => remove(d.id)} disabled={pending} aria-label="Delete document">
                <XIcon className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {collapsible && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-left text-sm text-primary hover:underline"
          >
            + {documents.length - PREVIEW_COUNT} more…
          </button>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Select value={kind} items={kinds} onValueChange={(v) => setKind(v ?? "")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="w-auto"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" onClick={upload} disabled={pending || !file}>
              <UploadIcon className="size-3.5 mr-1" />
              {pending ? "Uploading..." : "Add"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
