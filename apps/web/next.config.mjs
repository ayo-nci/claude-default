const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isCI = process.env.GITHUB_ACTIONS === "true";
const basePath = isCI && repo ? `/${repo}` : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  transpilePackages: ["@repo/ui", "@repo/types"],
  env: { NEXT_PUBLIC_BASE_PATH: basePath }
};

export default nextConfig;
