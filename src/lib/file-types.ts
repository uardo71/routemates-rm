// What a ticket accepts as an attachment and how it is served back. Any file is accepted except ones
// that run code when opened on Windows. Only images and PDFs are shown inline; everything else is
// served as a download with a neutral content type, so an uploaded .html or .svg can never execute
// inside the app's origin. Pure: shared by the upload validation, the serve route and the UI.

export const MAX_TICKET_FILE_BYTES = 25 * 1024 * 1024;
/** Stays under the server-action body limit (next.config.ts) with room for the form fields. */
export const MAX_TICKET_UPLOAD_BYTES = 45 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".msi", ".msix", ".appx", ".bat", ".cmd", ".com", ".scr", ".pif", ".cpl", ".dll", ".sys",
  ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".jar", ".lnk", ".reg", ".msc",
]);

const INLINE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/heic", "image/heif", "application/pdf",
]);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 || i === name.length - 1 ? "" : name.slice(i).toLowerCase();
}

export function isBlockedAttachment(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(fileExtension(name));
}

/** An image the browser can show in an <img> from our serve route (never SVG). */
export function isInlineImage(mime: string): boolean {
  return mime.startsWith("image/") && INLINE_TYPES.has(mime);
}

/** How the serve route sends a stored file back. */
export function servedAs(mime: string): { contentType: string; inline: boolean } {
  return INLINE_TYPES.has(mime) ? { contentType: mime, inline: true } : { contentType: "application/octet-stream", inline: false };
}

/** A Content-Disposition value that keeps non-ASCII names (RFC 6266 filename*). */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Validate a batch of ticket attachments; an error message or null. */
export function attachmentError(files: { name: string; size: number }[], maxFiles: number): string | null {
  if (files.length > maxFiles) return `Attach at most ${maxFiles} files at a time.`;
  let total = 0;
  for (const f of files) {
    if (isBlockedAttachment(f.name)) return `"${f.name}" is a program or script, which can't be attached — zip it first if it has to travel with the ticket.`;
    if (f.size > MAX_TICKET_FILE_BYTES) return `"${f.name}" is larger than ${MAX_TICKET_FILE_BYTES / 1024 / 1024}MB.`;
    total += f.size;
  }
  if (total > MAX_TICKET_UPLOAD_BYTES) return `These files add up to more than ${MAX_TICKET_UPLOAD_BYTES / 1024 / 1024}MB — send them in smaller batches.`;
  return null;
}
