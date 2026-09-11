"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  PaperclipIcon, SendIcon, XIcon, LockIcon, CornerDownRightIcon, FileTextIcon, Trash2Icon,
  PencilIcon, ExternalLinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InitialsAvatar } from "@/components/initials-avatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { attachmentError, isInlineImage } from "@/lib/file-types";

export type Attachment = { id: string; url: string; name: string; mime: string; size: number; canDelete: boolean };
export type CommentNode = {
  id: string; authorName: string; authorAvatar: string | null;
  body: string; internal: boolean; createdAt: string; mine: boolean;
  edited: boolean; deleted: boolean; canEdit: boolean; canDelete: boolean;
  attachments: Attachment[]; replies: CommentNode[];
};

/** `notice`: the comment was posted, but not exactly as asked (e.g. the internal tick was refused). */
type PostAction = (fd: FormData) => Promise<{ error?: string; notice?: string }>;
type DeleteAction = (id: string) => Promise<{ error?: string }>;
type EditAction = (id: string, body: string) => Promise<{ error?: string }>;

// ---------- lightbox ----------

const LightboxCtx = React.createContext<(url: string, name: string) => void>(() => {});

function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<{ url: string; name: string } | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <LightboxCtx.Provider value={(url, name) => setOpen({ url, name })}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/85 p-4" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between gap-2 text-sm text-white/80">
            <span className="truncate">{open.name}</span>
            <div className="flex items-center gap-3">
              <a href={open.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-white"><ExternalLinkIcon className="size-4" /> Open</a>
              <button onClick={() => setOpen(null)} className="hover:text-white"><XIcon className="size-5" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.name} className="max-h-full max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </LightboxCtx.Provider>
  );
}

export function Conversation({
  comments, canInternal, postAction, deleteAttachmentAction, editAction, deleteCommentAction, emptyLabel = "No messages yet.",
}: {
  comments: CommentNode[]; canInternal: boolean;
  postAction: PostAction; deleteAttachmentAction?: DeleteAction; editAction?: EditAction; deleteCommentAction?: DeleteAction; emptyLabel?: string;
}) {
  return (
    <LightboxProvider>
      <div className="flex flex-col gap-4">
        {comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {comments.map((c) => (
              <CommentItem key={c.id} node={c} depth={0} canInternal={canInternal} postAction={postAction} deleteAttachmentAction={deleteAttachmentAction} editAction={editAction} deleteCommentAction={deleteCommentAction} />
            ))}
          </div>
        )}
        <div className="border-t pt-4">
          <Composer postAction={postAction} canInternal={canInternal} placeholder="Write a message… paste or drop a screenshot to attach" />
        </div>
      </div>
    </LightboxProvider>
  );
}

function CommentItem({ node, depth, canInternal, postAction, deleteAttachmentAction, editAction, deleteCommentAction }: {
  node: CommentNode; depth: number; canInternal: boolean; postAction: PostAction; deleteAttachmentAction?: DeleteAction; editAction?: EditAction; deleteCommentAction?: DeleteAction;
}) {
  const router = useRouter();
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(node.body);
  const [busy, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  const indent = depth > 0;

  const saveEdit = () => {
    if (!editAction || !draft.trim()) return;
    start(async () => { const r = await editAction(node.id, draft); if (r?.error) setErr(r.error); else { setErr(null); setEditing(false); router.refresh(); } });
  };
  const del = () => {
    if (!deleteCommentAction || !confirm("Delete this message?")) return;
    start(async () => { const r = await deleteCommentAction(node.id); if (r?.error) setErr(r.error); else router.refresh(); });
  };

  return (
    <div className={cn(indent && "border-l-2 border-border/60 pl-3 sm:pl-4")}>
      <div className={cn("rounded-lg border p-3", node.deleted ? "border-dashed bg-muted/20" : node.internal ? "border-amber-500/40 bg-amber-500/[0.05]" : "bg-card")}>
        <div className="flex items-center gap-2">
          <InitialsAvatar name={node.authorName} src={node.authorAvatar ?? undefined} size="sm" />
          <span className="text-sm font-medium">{node.authorName}</span>
          {node.internal && <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-700 dark:text-amber-400"><LockIcon className="size-2.5" /> internal</span>}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {node.edited && !node.deleted && <span className="italic">edited</span>}
            <span title={node.createdAt.replace("T", " ").slice(0, 16)}>{relTime(node.createdAt)}</span>
          </span>
        </div>

        {node.deleted ? (
          <p className="mt-2 text-sm italic text-muted-foreground">This message was deleted.</p>
        ) : editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveEdit} disabled={busy}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(node.body); setErr(null); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {node.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{node.body}</p>}
            {node.attachments.length > 0 && <AttachmentGrid items={node.attachments} deleteAttachmentAction={deleteAttachmentAction} />}
          </>
        )}

        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}

        {!node.deleted && !editing && (
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => setReplying((r) => !r)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><CornerDownRightIcon className="size-3.5" /> Reply</button>
            {node.canEdit && editAction && <button onClick={() => { setEditing(true); setDraft(node.body); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><PencilIcon className="size-3.5" /> Edit</button>}
            {node.canDelete && deleteCommentAction && <button onClick={del} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"><Trash2Icon className="size-3.5" /> Delete</button>}
          </div>
        )}
      </div>

      {replying && (
        <div className="mt-2 pl-3 sm:pl-4">
          <Composer postAction={postAction} parentId={node.id} canInternal={canInternal} placeholder={`Reply to ${node.authorName}…`} autoFocus compact onDone={() => setReplying(false)} />
        </div>
      )}
      {node.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {node.replies.map((r) => (
            <CommentItem key={r.id} node={r} depth={Math.min(depth + 1, 4)} canInternal={canInternal} postAction={postAction} deleteAttachmentAction={deleteAttachmentAction} editAction={editAction} deleteCommentAction={deleteCommentAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentGrid({ items, deleteAttachmentAction }: { items: Attachment[]; deleteAttachmentAction?: DeleteAction }) {
  const router = useRouter();
  const openLightbox = React.useContext(LightboxCtx);
  const [, start] = React.useTransition();
  const images = items.filter((a) => isInlineImage(a.mime));
  const files = items.filter((a) => !isInlineImage(a.mime));
  const del = (id: string) => deleteAttachmentAction && start(async () => { await deleteAttachmentAction(id); router.refresh(); });
  return (
    <div className="mt-3 flex flex-col gap-3">
      {images.map((a) => (
        <div key={a.id} className="group relative w-fit max-w-full">
          <button type="button" onClick={() => openLightbox(a.url, a.name)} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} className="max-h-[70vh] w-auto max-w-full cursor-zoom-in rounded-lg border object-contain" />
          </button>
          {a.canDelete && deleteAttachmentAction && (
            <button onClick={() => del(a.id)} className="absolute right-2 top-2 rounded bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2Icon className="size-4" /></button>
          )}
        </div>
      ))}
      {files.map((a) => (
        <div key={a.id} className="flex w-fit max-w-full items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.name}</a>
          <span className="shrink-0 text-xs text-muted-foreground">{fmtBytes(a.size)}</span>
          {a.canDelete && deleteAttachmentAction && <button onClick={() => del(a.id)} className="text-muted-foreground/50 hover:text-destructive"><Trash2Icon className="size-3.5" /></button>}
        </div>
      ))}
    </div>
  );
}

export function Composer({ postAction, parentId, canInternal, placeholder, autoFocus, compact, onDone }: {
  postAction: PostAction; parentId?: string; canInternal: boolean; placeholder?: string; autoFocus?: boolean; compact?: boolean; onDone?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<{ file: File; preview: string | null }[]>([]);
  const [internal, setInternal] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).map((file) => ({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }));
    setFiles((f) => [...f, ...arr]);
  };
  const removeFile = (i: number) => setFiles((f) => { const n = f[i]; if (n?.preview) URL.revokeObjectURL(n.preview); return f.filter((_, j) => j !== i); });
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  function submit() {
    if (!body.trim() && files.length === 0) { setErr("Add a message or an attachment."); return; }
    const fileErr = attachmentError(files.map((f) => f.file), 10);
    if (fileErr) { setErr(fileErr); return; }
    const fd = new FormData();
    fd.set("body", body);
    if (parentId) fd.set("parentId", parentId);
    if (canInternal && internal) fd.set("internal", "1");
    files.forEach((f) => fd.append("files", f.file));
    start(async () => {
      const r = await postAction(fd);
      if (r?.error) setErr(r.error);
      else {
        if (r?.notice) toast.warning(r.notice);
        files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)); setBody(""); setFiles([]); setInternal(false); setErr(null); onDone?.(); router.refresh();
      }
    });
  }

  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border p-2 transition-colors", dragOver ? "border-primary bg-primary/5" : internal ? "border-amber-500/40" : "border-border")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
    >
      <Textarea
        value={body} onChange={(e) => setBody(e.target.value)} onPaste={onPaste}
        rows={compact ? 2 : 3} autoFocus={autoFocus} placeholder={placeholder ?? "Write a message…"}
        className={cn("border-0 bg-transparent p-1 shadow-none focus-visible:ring-0", internal && "placeholder:text-amber-700/60")}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            f.preview ? (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.preview} alt={f.file.name} className="h-20 w-20 rounded-md border object-cover" />
                <button onClick={() => removeFile(i)} className="absolute right-1 top-1 rounded bg-background/85 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><XIcon className="size-3.5" /></button>
              </div>
            ) : (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                <FileTextIcon className="size-3" /><span className="max-w-40 truncate">{f.file.name}</span>
                <button onClick={() => removeFile(i)}><XIcon className="size-3" /></button>
              </span>
            )
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" title="Attach any file — documents, e-mails, spreadsheets, archives, screenshots (up to 25MB each)"><PaperclipIcon className="size-3.5" /> Attach</button>
        {canInternal && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-amber-500" /> Internal note</label>}
        {err && <span className="text-xs text-destructive">{err}</span>}
        <Button size="sm" className="ml-auto gap-1.5" disabled={pending} onClick={submit}><SendIcon className="size-4" /> {parentId ? "Reply" : "Send"}</Button>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}
