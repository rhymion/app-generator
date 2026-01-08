import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: 'books.google.com'
      },
    ]
  },
  // devIndicators: false,
  experimental: {
    cacheComponents: true,
  },
};

export default nextConfig;
