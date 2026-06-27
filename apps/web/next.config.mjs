/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the workspace tax package (shipped as TS source).
  transpilePackages: ["@hisaab/tax"],
  // pdf-parse is CommonJS and must not be bundled by the server compiler.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
