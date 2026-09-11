import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for deployment: `.next/standalone` carries only the modules the
  // app actually imports, so the package pushed to App Service is tens of MB instead of the whole
  // node_modules tree, and the host runs `node server.js` without installing anything.
  output: "standalone",
  // Heavy CJS libraries used only in route handlers (Excel/PowerPoint generation) — keep them out
  // of the bundler so they load as normal Node modules at runtime.
  serverExternalPackages: ["exceljs", "pptxgenjs"],
  experimental: {
    // Default is 1MB — receipt photos from a phone camera alone often exceed that, and a ticket
    // can carry specs, e-mails and archives (up to 25MB a file, 45MB a batch — src/lib/file-types.ts).
    // Server Actions are how uploads reach the server, so the limit lives here.
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // proxy.ts runs on every request and Next buffers the body for it — only up to 10MB by default,
    // silently passing a TRUNCATED body on. Keep this at least as large as bodySizeLimit.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
