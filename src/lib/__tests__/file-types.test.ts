import { describe, it, expect } from "vitest";
import {
  fileExtension, isBlockedAttachment, isInlineImage, servedAs, contentDisposition, attachmentError,
  MAX_TICKET_FILE_BYTES,
} from "@/lib/file-types";

describe("ticket attachments", () => {
  it("accepts office files, e-mails, archives, text and exports", () => {
    for (const n of ["Spec v2.docx", "UAT sign-off.msg", "K900123 transports.zip", "log.txt", "data.csv", "mail.eml", "flow.vsdx", "abap.abap", "README"]) {
      expect(isBlockedAttachment(n), n).toBe(false);
    }
  });
  it("blocks programs and scripts, whatever the case", () => {
    for (const n of ["setup.EXE", "run.bat", "fix.ps1", "a.vbs", "invoice.pdf.js", "tool.msi", "link.lnk"]) {
      expect(isBlockedAttachment(n), n).toBe(true);
    }
  });
  it("reads the extension from the last dot only", () => {
    expect(fileExtension("archive.tar.GZ")).toBe(".gz");
    expect(fileExtension(".bashrc")).toBe("");
    expect(fileExtension("noext")).toBe("");
  });
  it("serves images and PDFs inline, everything else as a neutral download", () => {
    expect(servedAs("image/png")).toEqual({ contentType: "image/png", inline: true });
    expect(servedAs("application/pdf")).toEqual({ contentType: "application/pdf", inline: true });
    expect(servedAs("image/svg+xml")).toEqual({ contentType: "application/octet-stream", inline: false });
    expect(servedAs("text/html")).toEqual({ contentType: "application/octet-stream", inline: false });
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("image/jpeg")).toBe(true);
    expect(isInlineImage("application/pdf")).toBe(false);
  });
  it("keeps non-ASCII names in the download header", () => {
    const h = contentDisposition("Übergabe \"final\".pdf", false);
    expect(h).toBe(`attachment; filename="_bergabe _final_.pdf"; filename*=UTF-8''%C3%9Cbergabe%20%22final%22.pdf`);
  });
  it("validates count, size and the total of a batch", () => {
    expect(attachmentError([{ name: "a.docx", size: 1000 }], 10)).toBeNull();
    expect(attachmentError([{ name: "a.exe", size: 1000 }], 10)).toMatch(/program or script/);
    expect(attachmentError([{ name: "big.mp4", size: MAX_TICKET_FILE_BYTES + 1 }], 10)).toMatch(/larger than 25MB/);
    expect(attachmentError([{ name: "a.pdf", size: 1 }, { name: "b.pdf", size: 1 }], 1)).toMatch(/at most 1 files/);
    const twenty = 20 * 1024 * 1024;
    expect(attachmentError([{ name: "a.zip", size: twenty }, { name: "b.zip", size: twenty }, { name: "c.zip", size: twenty }], 10)).toMatch(/smaller batches/);
  });
});
