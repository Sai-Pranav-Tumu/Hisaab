/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the workspace tax package (shipped as TS source).
  transpilePackages: ["@hisaab/tax"],
  // These are heavy server-only CJS libs that must not be bundled by the compiler.
  serverExternalPackages: ["pdf-parse", "exceljs"],
};

export default nextConfig;
