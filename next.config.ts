import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // 2026-07-15: quedan ~155 errores de tipos legacy (recharts formatters,
  // logAudit params, páginas admin). Bajarlos a 0 y borrar este bloque.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Force Argentina timezone on serverless functions (Vercel runs in us-east)
  env: {
    TZ: 'America/Argentina/Tucuman',
  },
};

export default nextConfig;
