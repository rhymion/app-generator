import 'dayjs/locale/ja';
import { jaJP as coreJaJP } from '@mui/material/locale';
import { jaJP as dataGridJaJP } from '@mui/x-data-grid/locales';
import { jaJP as pickersJaJP } from '@mui/x-date-pickers/locales';

// MUI ships its built-in UI text (DataGrid column menu / filter panel /
// "Manage columns", picker toolbars and buttons) as locale bundles. English is
// the library default, so only the non-English app locales need a bundle.
const MUI_LOCALE_BUNDLES: Record<string, object[]> = {
  ja: [coreJaJP, dataGridJaJP, pickersJaJP],
};

// dayjs locale name per app locale. Pickers format month / weekday names and
// the week start through the dayjs locale passed to LocalizationProvider.
const DAYJS_LOCALES: Record<string, string> = {
  en: 'en',
  ja: 'ja',
};

/** MUI locale bundles (core, DataGrid, date pickers) for `createTheme`. */
export function getMuiLocaleBundles(locale: string): object[] {
  return MUI_LOCALE_BUNDLES[locale] ?? [];
}

/** dayjs locale name for the picker adapter; falls back to English. */
export function getDayjsLocale(locale: string): string {
  return DAYJS_LOCALES[locale] ?? 'en';
}
