import fs from "node:fs";
import path from "node:path";

/**
 * Terms of Service / Privacy Policy content lives outside `app/` as plain
 * Markdown, one file per (document, locale): `content/legal/<doc>.<locale>.md`.
 * Adding a language is dropping in a new file — this module discovers
 * locales by directory listing instead of a hardcoded list, so no code
 * change is needed. See docs/knowledge/legal-documents.md for the design
 * rationale and the placeholder list editors must fill in before shipping.
 */

export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type LegalDocId = (typeof LEGAL_DOCS)[number];

export function isLegalDocId(value: string): value is LegalDocId {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

const LEGAL_CONTENT_DIR = path.join(process.cwd(), "content", "legal");

type LocaleFile = { locale: string; file: string };

function listLocaleFiles(doc: LegalDocId): LocaleFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(LEGAL_CONTENT_DIR);
  } catch {
    return [];
  }
  const pattern = new RegExp(`^${doc}\\.([a-zA-Z][a-zA-Z-]*)\\.md$`);
  const matches: LocaleFile[] = [];
  for (const name of entries) {
    const match = pattern.exec(name);
    if (match) matches.push({ locale: match[1], file: name });
  }
  return matches.sort((a, b) => a.locale.localeCompare(b.locale));
}

/** Locales that currently have content for `doc`, discovered from disk. */
export function getAvailableLegalLocales(doc: LegalDocId): string[] {
  return listLocaleFiles(doc).map((entry) => entry.locale);
}

/**
 * Resolve and read the Markdown source for `doc`. Falls back from
 * `requestedLocale` to `fallbackLocale` to whatever locale happens to be
 * available, so a document missing a translation never 404s outright.
 * Returns null only when the document has no content files at all.
 */
export function readLegalDocument(
  doc: LegalDocId,
  requestedLocale: string,
  fallbackLocale: string,
): { locale: string; content: string } | null {
  const files = listLocaleFiles(doc);
  if (files.length === 0) return null;

  const pick =
    files.find((f) => f.locale === requestedLocale) ??
    files.find((f) => f.locale === fallbackLocale) ??
    files[0]!;

  const content = fs.readFileSync(path.join(LEGAL_CONTENT_DIR, pick.file), "utf-8");
  return { locale: pick.locale, content };
}
