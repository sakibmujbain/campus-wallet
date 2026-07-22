/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The `pg` driver is a native/server-only dependency; keep it out of any client bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
