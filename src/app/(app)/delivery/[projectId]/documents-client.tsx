"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadIcon, SearchIcon, Trash2Icon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadDeliveryDocumentAction, deleteDeliveryDocumentAction } from "../actions";

export type LibraryDoc = { id: string; kind: string; fileName: string; originalName: string; uploadedAt: string; uploadedByName: string };

const KINDS: { value: string; label: string }[] = [
  { value: "PROJECT_PLAN", label: "Project plan" },
  { value: "STATUS_UPDATE", label: "Status update" },
  { value: "MEETING_MINUTES", label: "Meeting minutes" },
  { value: "CUTOVER_PLAN", label: "Cutover plan" },
  { value: "KICKOFF", label: "Kickoff" },
  { value: "SCOPE", label: "Scope / SoW" },
  { value: "UAT_ACCEPTANCE", label: "Signed acceptance" },
  { value: "OTHER", label: "Other" },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));

export function DocumentsLibraryClient({ projectId, engagementId, docs }: { projectId: string; engagementId: string | null; docs: LibraryDoc[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("PROJECT_PLAN");
  const [file, setFile] = useState<File | null>(null);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => (kindFilter === "ALL" || d.kind === kindFilter) && (!needle || `${d.originalName} ${KIND_LABEL[d.kind] ?? d.kind}`.toLowerCase().includes(needle)));
  }, [docs, q, kindFilter]);

  function upload() {
    if (!file) return toast.error("Pick a file.");
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    if (engagementId) fd.append("engagementId", engagementId);
    start(async () => {
      const r = await uploadDeliveryDocumentAction(projectId, fd);
      if (r.error) toast.error(r.error);
      else { toast.success("Uploaded."); setFile(null); if (fileRef.current) fileRef.current.value = ""; router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this document?")) return;
    start(async () => { const r = await deleteDeliveryDocumentAction(id); if (r.error) toast.error(r.error); else { toast.success("Deleted."); router.refresh(); } });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload a document</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={kind} items={KINDS} onValueChange={(v) => setKind(v ?? "PROJECT_PLAN")}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-56">
              <Label>File</Label>
              <Input ref={fileRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button size="sm" onClick={upload} disabled={pending || !file}><UploadIcon className="size-3.5" /> Upload</Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">PDF, images, and Office files (Excel/Word/PowerPoint) up to 10MB. Files are stored securely and served only to authorized users. A <span className="font-medium text-foreground">Meeting minutes</span> or <span className="font-medium text-foreground">Status update</span> file also creates its entry in the Minutes / Status updates tab, so decks made in another template still count.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Documents <span className="font-normal text-muted-foreground">({docs.length})</span></CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" className="pl-8" />
            </div>
            <Select value={kindFilter} items={[{ value: "ALL", label: "All types" }, ...KINDS]} onValueChange={(v) => setKindFilter(v ?? "ALL")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All types</SelectItem>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Type</TableHead><TableHead>File</TableHead><TableHead>Uploaded</TableHead><TableHead>By</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id} className="hover:bg-muted/40">
                    <TableCell><Badge variant="outline">{KIND_LABEL[d.kind] ?? d.kind}</Badge></TableCell>
                    <TableCell>
                      <a href={`/api/documents/${d.fileName}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                        <FileTextIcon className="size-3.5" /> {d.originalName}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">{d.uploadedAt}</TableCell>
                    <TableCell className="text-muted-foreground">{d.uploadedByName}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(d.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{docs.length === 0 ? "No documents yet — upload the plan, status decks, minutes, and anything you send." : "Nothing matches."}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
