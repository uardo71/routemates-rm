import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
