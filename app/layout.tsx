import Link from 'next/link';
import { Inconsolata } from 'next/font/google';
import type { Metadata } from 'next';
//import type { LayoutProps } from '@/lib/types';
import './globals.css';

const fnt = Inconsolata({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Reading Recorder',
  description: '自分が読んだ書籍の記録を残すためのアプリ',
};

export default function RootLayout({ children, header, sidebar, footer }: Readonly<{
  children: React.ReactNode;
  header: React.ReactNode;
  sidebar: React.ReactNode;
  footer: React.ReactNode;
}>) 
{
  return (
    <html lang="ja">
      <body className={fnt.className}>
        <div>{ header }</div>
        <div className="flex">
          <div>{ sidebar }</div>
          <div className="ml-2">
            {children}
          </div>
        </div>
        <div>{ footer }</div>
      </body>
    </html>
  );
}
