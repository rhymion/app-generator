import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import createMDX from '@next/mdx'
import remarkGfm from 'remark-gfm'

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

const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkGfm],
  },
})

// Merge MDX config with Next.js config
export default withNextIntl(withMDX(nextConfig));
