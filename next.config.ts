import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import createMDX from '@next/mdx'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  images: {
    remotePatterns: [
      {
        hostname: 'books.google.com'
      },
    ]
  },
  // /uploads/* is what `/api/upload` returns and what `attachment.path`
  // rows store. In production (`next start`) the public-asset handler
  // only serves files that existed in `public/uploads/` at build time —
  // runtime uploads return 404. Rewriting to `/api/uploads/:path*`
  // (handled by app/api/uploads/[...path]/route.ts) makes runtime files
  // reachable in prod too, without changing any stored URL.
  async rewrites() {
    return [
      { source: '/uploads/:path*', destination: '/api/uploads/:path*' },
    ];
  },
  // devIndicators: false,
  // cacheComponents: true,
};

const withMDX = createMDX({})

// Merge MDX config with Next.js config
export default withNextIntl(withMDX(nextConfig));
