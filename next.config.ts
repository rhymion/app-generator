import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import createMDX from '@next/mdx'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // Terms of Service / Privacy Policy pages (app/[locale]/legal/*) read
  // content/legal/*.md at request time via fs.readFileSync with a
  // runtime-built path, so Vercel's build-time file tracer can't discover
  // the dependency by static analysis. Without this hint, adding a new
  // content/legal/<doc>.<locale>.md file works locally (full source tree
  // present) but silently 404s once deployed, because the tracer omits the
  // untraceable file from the serverless function bundle.
  outputFileTracingIncludes: {
    '/**': ['./content/legal/**/*'],
  },
  // Phase 4 #10 from performance-plan-session.md.
  //  - `formats`: serve AVIF/WEBP when the browser accepts it; saves ~30-50%
  //    bytes on the upload-heavy patient/clinic photos vs PNG/JPEG.
  //  - `minimumCacheTTL` (1 day): avatars/photos rarely change; the previous
  //    default (60s) made the image optimizer re-process every minute.
  //  - `remotePatterns` includes the Vercel Blob bucket used by
  //    `app/api/upload/route.ts` so user uploads served from
  //    *.public.blob.vercel-storage.com flow through next/image.
  // Follow-up: the codebase still uses raw <img> in ImageDisplay, ImageUpload,
  // ListWrapper, EditableListWrapper, OrderedEditableListWrapper — none of
  // these benefit from this config until they're switched to next/image.
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24,
    remotePatterns: [
      { hostname: 'books.google.com' },
      { hostname: '*.public.blob.vercel-storage.com' },
    ],
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
