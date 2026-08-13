// Avatars are stored on disk under uploads/avatars/ (via the shared receipt-storage helpers) and
// served only through the authenticated route at /api/avatars/[fileName]. The DB keeps just the
// file name in User.avatarUrl; this builds the URL consumers actually render.
export function avatarSrc(fileName: string | null | undefined): string | null {
  return fileName ? `/api/avatars/${fileName}` : null;
}

// We don't persist a mime type for avatars, so infer it from the extension we saved with. Only the
// image types allowed by isAllowedReceiptType can reach here.
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function avatarContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";
}
