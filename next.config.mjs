/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { serverActions: { bodySizeLimit: '1024mb' } },
};
export default nextConfig;
