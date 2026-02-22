import { Inconsolata } from 'next/font/google';
import type { Metadata } from 'next';
import Providers from "./providers";
import './globals.css';
import Header from './@header/page';
import Footer from './@footer/page';
import SessionSidebar from '@/components/SessionSidebar';
import { siteConfig } from '@/lib/site-config';

const fnt = Inconsolata({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: siteConfig.title,
  description: '自分が読んだ書籍の記録を残すためのアプリ',
};

export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={fnt.className}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <div className="flex flex-1 relative">
              <SessionSidebar />
              <main className="flex-1 min-w-0 p-3">
                {children}
              </main>
            </div>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
