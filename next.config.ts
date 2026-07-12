import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Playwright uses a separate build directory so its isolated test server can
  // run alongside a developer's existing `next dev` process.
  distDir: process.env.NORTHSTAR_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
