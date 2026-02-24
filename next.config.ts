import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
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

export default withNextIntl(nextConfig);
