import { getTranslations, setRequestLocale } from "next-intl/server";
import AppText from "@/components/ui/AppText";
import LegalDocumentView from "@/components/legal/LegalDocumentView";

export default async function TermsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { locale } = await params;
  const { lang } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Legal");

  return (
    <>
      <AppText variant="h4" fontWeight="bold" mb={2}>
        {t("termsTitle")}
      </AppText>
      <LegalDocumentView doc="terms" siteLocale={locale} requestedLocale={lang} />
    </>
  );
}
