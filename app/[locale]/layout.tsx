import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Providers from "./providers";
import Header from './@header/page';
import Footer from './@footer/page';
import SessionSidebar from '@/components/_standard/SessionSidebar';
import { siteConfig, themeConfig } from '@/lib/site-config';
import { routing } from '@/i18n/routing';
import { canAccess } from '@/lib/authz';

export const metadata: Metadata = {
  title: siteConfig.title,
  description: 'App generator PoC site',
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

  // Hide sidebar menus for entities the current user cannot read — surfacing a
  // link that only leads to an access-denied error is confusing. Home ("/") and
  // external links are always shown; every other nav link maps to a model whose
  // permission name is its route segment (e.g. "/channel" -> "channel").
  const entityLinks = siteConfig.navLinks.filter((l) => !l.external && l.href !== '/');
  const readable = await Promise.all(
    entityLinks.map((l) => canAccess(l.href.slice(1), 'read')),
  );
  const hiddenHrefs = entityLinks.filter((_, i) => !readable[i]).map((l) => l.href);

  return (
    <NextIntlClientProvider messages={messages}>
      <Providers>
        <div className="min-h-screen flex flex-col">
          <Header />
          <div className="flex flex-1 relative">
            <SessionSidebar hiddenHrefs={hiddenHrefs} />
            <main className={`flex-1 min-w-0 p-4 md:p-6 ${themeConfig.content.background}`}>
              {children}
            </main>
          </div>
          <Footer />
        </div>
      </Providers>
    </NextIntlClientProvider>
  );
}
