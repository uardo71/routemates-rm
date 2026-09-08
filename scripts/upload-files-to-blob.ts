/**
 * Cutover helper: copy everything under `uploads/` into the configured object store.
 *
 * Local disk is fine on one machine, but a PaaS host wipes the filesystem on every restart and
 * redeploy. Set AZURE_BLOB_SAS_URL (a container-scoped SAS with read/write/delete), then run this
 * once to carry the existing files across. `src/lib/storage.ts` switches backend on the same
 * variable, so the app reads from Blob from that point on.
 *
 *   pnpm exec tsx scripts/upload-files-to-blob.ts          # dry run, uploads nothing
 *   pnpm exec tsx scripts/upload-files-to-blob.ts --apply  # upload
 *
 * Idempotent: re-running overwrites blobs with identical content, so a partial run is safe to
 * repeat. Nothing is deleted from local disk — keep it until you've confirmed the app serves files.
 */
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { putFile, usingObjectStorage } from "../src/lib/storage";

const APPLY = process.argv.includes("--apply");
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

// Matches the serve routes; anything else is stored as a generic download.
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".heic": "image/heic", ".heif": "image/heif", ".pdf": "application/pdf",
  ".csv": "text/csv", ".txt": "text/plain", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function main() {
  if (!usingObjectStorage()) {
    console.error(
      "AZURE_BLOB_SAS_URL is not set, so there is no object store to copy into.\n" +
        "Set it to a container SAS URL (https://<account>.blob.core.windows.net/<container>?sv=...) and re-run.",
    );
    process.exit(1);
  }
  console.log(APPLY ? "UPLOADING" : "DRY RUN (nothing will be uploaded)");

  let subdirs: string[];
  try {
    const entries = await readdir(UPLOADS_ROOT, { withFileTypes: true });
    subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.error(`No uploads directory at ${UPLOADS_ROOT} — nothing to do.`);
    process.exit(0);
  }

  let count = 0;
  let bytes = 0;
  let failed = 0;
  for (const subdir of subdirs) {
    const dir = path.join(UPLOADS_ROOT, subdir);
    const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile());
    console.log(`\n${subdir}/  (${files.length} file${files.length === 1 ? "" : "s"})`);
    for (const f of files) {
      const full = path.join(dir, f.name);
      const size = (await stat(full)).size;
      const type = CONTENT_TYPES[path.extname(f.name).toLowerCase()] ?? "application/octet-stream";
      if (APPLY) {
        try {
          await putFile(subdir, f.name, await readFile(full), type);
        } catch (e) {
          failed++;
          console.log(`  FAILED ${f.name} — ${(e as Error).message}`);
          continue;
        }
      }
      count++;
      bytes += size;
      console.log(`  ${APPLY ? "uploaded" : "would upload"} ${f.name}  ${(size / 1024).toFixed(1)} KB  ${type}`);
    }
  }

  console.log(`\n${APPLY ? "Uploaded" : "Would upload"} ${count} file(s), ${(bytes / 1024 / 1024).toFixed(2)} MB.`);
  if (failed > 0) {
    console.log(`${failed} file(s) FAILED — re-run to retry; it is safe to repeat.`);
    process.exit(1);
  }
  if (!APPLY) console.log("Re-run with --apply to upload.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
