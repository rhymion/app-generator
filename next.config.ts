import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import createMDX from '@next/mdx'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  output: 'standalone',
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
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
  experimental: {
    // cmd_369: broadening the proxy matcher to all of /api/* (for CORS)
    // now routes CSV import bodies through the proxy layer too, which caps
    // bodies at 10MB by default — the same threshold the import routes'
    // own MAX_IMPORT_BYTES check enforces (app/api/*/import/route.ts).
    // Without headroom here, the proxy silently truncates an over-limit
    // payload to exactly 10MB before the route handler can see its real
    // size, turning a clean 400 FILE_TOO_LARGE into a JSON parse failure
    // (500). Raised above the app's own ceiling so that check still runs
    // against the full, untruncated body.
    proxyClientMaxBodySize: '15mb',
  },
};

const withMDX = createMDX({})

// Merge MDX config with Next.js config
export default withNextIntl(withMDX(nextConfig));
