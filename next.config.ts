import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy CJS libraries used only in route handlers (Excel/PowerPoint generation) — keep them out
  // of the bundler so they load as normal Node modules at runtime.
  serverExternalPackages: ["exceljs", "pptxgenjs"],
  experimental: {
    // Default is 1MB — receipt photos from a phone camera alone often exceed that, and an
    // expense can carry several (e.g. hotel folio + taxi slip). Server Actions are how
    // receipt uploads reach the server (see expenses/actions.ts), so the limit lives here.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
