import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Providers from "./providers";
import Header from './@header/page';
import Footer from './@footer/page';
import SessionSidebar from '@/components/SessionSidebar';
import { siteConfig } from '@/lib/site-config';
import { routing } from '@/i18n/routing';

export const metadata: Metadata = {
  title: siteConfig.title,
  description: '自分が読んだ書籍の記録を残すためのアプリ',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
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
    </NextIntlClientProvider>
  );
}
