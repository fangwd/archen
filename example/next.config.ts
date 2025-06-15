import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        pg: 'commonjs pg',
        sqlite3: 'commonjs sqlite3',
      });
    }
    return config;
  }
};

export default nextConfig;
