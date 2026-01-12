import { Inconsolata } from 'next/font/google';
import type { Metadata } from 'next';
//import type { LayoutProps } from '@/lib/types';
import Providers from "./providers";
import './globals.css';
import Header from './@header/page';
import Footer from './@footer/page';
import SessionSidebar from '@/components/SessionSidebar';

const fnt = Inconsolata({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Reading Recorder',
  description: '自分が読んだ書籍の記録を残すためのアプリ',
};

export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={fnt.className}>
        <Providers>
          <Header />
          <div className="flex">
            <SessionSidebar />
            <div className="ml-2">
              {children}
            </div>
          </div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
