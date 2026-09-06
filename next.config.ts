import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The dev overlay badge sits in the corner of every screen recording.
  devIndicators: false,
};
export default nextConfig;
