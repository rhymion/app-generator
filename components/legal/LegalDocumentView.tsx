import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import AppText from "@/components/ui/AppText";
import AppBox from "@/components/ui/AppBox";
import {
  getAvailableLegalLocales,
  readLegalDocument,
  type LegalDocId,
} from "@/lib/legal/content";

/**
 * Shared renderer for app/[locale]/legal/terms and .../privacy. `siteLocale`
 * is the app UI locale (en/ja, gated by i18n/routing.ts); `requestedLocale`
 * is the independent *document* language picked via `?lang=`. Keeping the
 * two separate means a new document translation (content/legal/<doc>.<xx>.md)
 * never needs `i18n/routing.ts`'s locale list touched — see
 * docs/knowledge/legal-documents.md.
 */
export default async function LegalDocumentView({
  doc,
  siteLocale,
  requestedLocale,
}: {
  doc: LegalDocId;
  siteLocale: string;
  requestedLocale?: string;
}) {
  const t = await getTranslations("Legal");
  const availableLocales = getAvailableLegalLocales(doc);
  const resolved = readLegalDocument(doc, requestedLocale ?? siteLocale, siteLocale);

  const routePath = doc === "terms" ? "/legal/terms" : "/legal/privacy";

  return (
    <AppBox>
      <AppText variant="body2" color="text.secondary" mb={2}>
        {t("templateDisclaimer")}
      </AppText>

      {availableLocales.length > 1 && (
        <AppBox display="flex" gap={1} mb={3}>
          <AppText variant="body2" component="span">
            {t("languageSwitcherLabel")}:
          </AppText>
          {availableLocales.map((loc) => (
            <Link key={loc} href={`${routePath}?lang=${loc}`}>
              {loc}
            </Link>
          ))}
        </AppBox>
      )}

      {resolved ? (
        <article className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{resolved.content}</ReactMarkdown>
        </article>
      ) : (
        <AppText>{t("documentUnavailable")}</AppText>
      )}
    </AppBox>
  );
}
