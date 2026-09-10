import { describe, it, expect } from "vitest";
import { titleFromFileName, dateFromFileName } from "@/lib/doc-naming";

describe("titleFromFileName", () => {
  it("drops the extension and a trailing version tag", () => {
    expect(titleFromFileName("BEKO- Meeting Minute 2026.09.10 v1.0.pdf")).toBe("BEKO- Meeting Minute 2026.09.10");
    expect(titleFromFileName("Status update W37 V2.pptx")).toBe("Status update W37");
    expect(titleFromFileName("kickoff.PDF")).toBe("kickoff");
  });
  it("never returns an empty title", () => {
    expect(titleFromFileName(".pdf")).toBe("Untitled");
  });
});

describe("dateFromFileName", () => {
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  it("reads yyyy.mm.dd, yyyy-mm-dd, yyyymmdd and dd.mm.yyyy", () => {
    expect(iso(dateFromFileName("BEKO- Meeting Minute 2026.09.10 v1.0.pdf"))).toBe("2026-09-10");
    expect(iso(dateFromFileName("status_2026-09-12.pptx"))).toBe("2026-09-12");
    expect(iso(dateFromFileName("minutes 20260901.docx"))).toBe("2026-09-01");
    expect(iso(dateFromFileName("minutes 10.09.2026.docx"))).toBe("2026-09-10");
  });
  it("returns null when there is no plausible date", () => {
    expect(dateFromFileName("kickoff deck v3.pptx")).toBeNull();
    expect(dateFromFileName("weekly 2026.13.45.pdf")).toBeNull();
    expect(dateFromFileName("2026.02.31 minutes.pdf")).toBeNull();
  });
});
