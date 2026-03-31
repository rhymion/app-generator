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
  // devIndicators: false,
  // cacheComponents: true,
};

const withMDX = createMDX({})

// Merge MDX config with Next.js config
export default withNextIntl(withMDX(nextConfig));
