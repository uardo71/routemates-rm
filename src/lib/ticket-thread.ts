import type { Prisma } from "@prisma/client";
import { avatarSrc } from "@/lib/avatar";
import type { CommentNode } from "@/app/(app)/tickets/conversation";

export type HistoryEvent = { id: string; kind: string; body: string; authorName: string; createdAt: string };

export type RawComment = {
  id: string; parentId: string | null; kind: string; body: string | null; internal: boolean;
  authorId: string; editedAt: Date | null; deletedAt: Date | null; createdAt: Date;
  author: { name: string; avatarUrl: string | null };
  attachments: { id: string; fileName: string; originalName: string; mimeType: string; sizeBytes: number; uploadedById: string }[];
};

/** Split raw comments into a threaded conversation tree (COMMENT kind) and a flat history of system
 *  events. `hideInternal` drops staff-only notes (customer portal view). `canManage` lets a viewer
 *  delete anyone's attachment; otherwise only their own. */
export function buildThread(
  comments: RawComment[], currentUserId: string, opts: { hideInternal?: boolean; canManage?: boolean } = {},
): { conversation: CommentNode[]; history: HistoryEvent[] } {
  const iso = (d: Date) => d.toISOString();
  const visible = comments.filter((c) => !(opts.hideInternal && c.internal));

  const history: HistoryEvent[] = visible
    .filter((c) => c.kind !== "COMMENT")
    .map((c) => ({ id: c.id, kind: c.kind, body: c.body ?? "", authorName: c.author.name, createdAt: iso(c.createdAt) }));

  const commentRows = visible.filter((c) => c.kind === "COMMENT");
  const byId = new Map(commentRows.map((c) => [c.id, c]));
  const mineOrManage = (authorId: string) => opts.canManage === true || authorId === currentUserId;
  const node = (c: RawComment): CommentNode => ({
    id: c.id, authorName: c.author.name, authorAvatar: avatarSrc(c.author.avatarUrl) ?? null,
    body: c.deletedAt ? "" : (c.body ?? ""), internal: c.internal, createdAt: iso(c.createdAt), mine: c.authorId === currentUserId,
    edited: !!c.editedAt, deleted: !!c.deletedAt,
    canEdit: !c.deletedAt && mineOrManage(c.authorId),
    canDelete: !c.deletedAt && mineOrManage(c.authorId),
    attachments: c.deletedAt ? [] : c.attachments.map((a) => ({
      id: a.id, url: `/api/tickets/attachments/${a.fileName}`, name: a.originalName, mime: a.mimeType, size: a.sizeBytes,
      canDelete: mineOrManage(a.uploadedById),
    })),
    replies: [],
  });

  const nodes = new Map(commentRows.map((c) => [c.id, node(c)]));
  const roots: CommentNode[] = [];
  for (const c of commentRows) {
    const n = nodes.get(c.id)!;
    // Re-root orphans (parent hidden/absent) so nothing disappears.
    const parent = c.parentId && byId.has(c.parentId) ? nodes.get(c.parentId) : null;
    if (parent) parent.replies.push(n);
    else roots.push(n);
  }
  return { conversation: roots, history };
}

export const COMMENT_INCLUDE = {
  orderBy: { createdAt: "asc" },
  include: {
    author: { select: { name: true, avatarUrl: true } },
    attachments: { select: { id: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, uploadedById: true } },
  },
} satisfies Prisma.Ticket$commentsArgs;
