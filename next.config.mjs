/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pg uses Node.js native modules — stub them out for client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        dns: false,
        net: false,
        tls: false,
        pg: false,
      };
    }
    return config;
  },
};

export default nextConfig;
