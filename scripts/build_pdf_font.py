#!/usr/bin/env python3
"""
Build a slim Noto Sans JP subset for the checkup PDF.

Why
---
@react-pdf/renderer parses the registered font and walks every glyph table on
the JS main thread when generating the PDF. For the full Noto Sans JP
"Japanese" subset (~17k glyphs + heavy OpenType layout tables) that walk takes
30–90s. Pre-subsetting at build time cuts that to under a second:

  - keep only the codepoints we actually render (kana, ASCII, fullwidth,
    CJK basic + every literal character from `create_pdf.tsx`);
  - drop GSUB / GPOS / GDEF / kern — react-pdf's simple text layout never
    needs them;
  - drop hinting and glyph names — not relevant for embedded PDF fonts.

Output format is raw TTF (no woff2 wrapper) on purpose: Chromium's font
sanitizer has been observed to mis-report "invalid sfntVersion" when a
Next.js dev server serves a newly-dropped woff2 file, and the
@react-pdf/font browser loader still uses fontkit-on-fetch which is
indifferent to the wrapper. Raw TTF removes the variable.

Input  : node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-{weight}-normal.woff2
Output : public/fonts/noto-jp-report-{regular,bold}.ttf

Run once after `npm install`. The output files are committed so the dev
loop and CI builds don't have to regenerate them.
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

try:
    from fontTools.subset import Subsetter, Options, load_font, save_font
except ImportError:  # pragma: no cover - clear actionable error
    sys.exit("fonttools is required. Install with: pip install 'fonttools[woff]'")


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / 'node_modules' / '@fontsource' / 'noto-sans-jp' / 'files'
OUTPUT_DIR = REPO_ROOT / 'public' / 'fonts'
WEIGHTS = [('400', 'regular'), ('700', 'bold')]

# Codepoint ranges to keep regardless of what the JSX contains. These cover
# the conventional "Japanese text" repertoire so dynamically-injected data
# (patient names, doctor names, dates) still renders even if a character
# never appears in `create_pdf.tsx`.
UNICODE_RANGES: list[tuple[int, int]] = [
    (0x0020, 0x007E),   # Basic Latin printable
    (0x00A0, 0x00FF),   # Latin-1 supplement (degree sign, ±, etc.)
    (0x2010, 0x2027),   # General punctuation (em dash, ellipsis)
    (0x2190, 0x21FF),   # Arrows (occasional in summary pills)
    (0x25A0, 0x25FF),   # Geometric shapes (●○■□ used in legends)
    (0x3000, 0x303F),   # CJK symbols and punctuation (、。「」〜〇・)
    (0x3040, 0x309F),   # Hiragana
    (0x30A0, 0x30FF),   # Katakana
    (0x4E00, 0x9FAF),   # CJK Unified Ideographs (basic — the kanji block)
    (0xFF00, 0xFFEF),   # Halfwidth and fullwidth forms
]

# Glyphs that must be preserved even if no `cmap` entry references them.
EXTRA_GLYPH_NAMES = ['.notdef', '.null']


def chars_from_jsx(path: Path) -> set[int]:
    """Extract every codepoint that appears anywhere in `create_pdf.tsx`.
    Overshoots (includes identifiers, JSX syntax) but the cost of keeping a
    handful of extra ASCII glyphs is zero — we already keep all ASCII."""
    text = path.read_text(encoding='utf-8')
    return {ord(c) for c in text}


def build_subset(source: Path, target: Path, codepoints: set[int]) -> None:
    options = Options()
    # Emit raw TTF (no woff/woff2 wrapper). Two reasons:
    #   1. We already aggressively drop layout tables and hinting, so the
    #      uncompressed TTF is around 2 MB — bigger on the wire than woff2,
    #      but the dev/CI pipeline gzip-compresses it on the way out so the
    #      bytes the browser actually pulls are comparable.
    #   2. The woff2 wrapper interacts badly with some dev-server pipelines:
    #      Chromium's font sanitizer (OTS) on the receiving end has been
    #      observed to report "invalid sfntVersion" when a Next.js Turbopack
    #      dev session serves a freshly-dropped woff2 file. Raw TTF skips the
    #      wrapper entirely; if `react-pdf` says "fetch ok" then fontkit just
    #      reads the sfnt directly.
    options.flavor = None
    options.with_zopfli = False
    options.desubroutinize = True         # CFF-only, harmless for TTF
    options.hinting = False
    options.glyph_names = False
    options.legacy_kern = False
    options.name_IDs = ['*']              # keep all name records (license)
    options.name_legacy = True
    options.recommended_glyphs = True
    options.notdef_glyph = True
    options.notdef_outline = True
    # The big saving: react-pdf's text layout is plain glyph-by-glyph; it
    # never invokes OpenType shaping, so the substitution/positioning tables
    # are dead weight that just slows down the initial parse.
    options.layout_features = []
    options.drop_tables = ['GSUB', 'GPOS', 'GDEF', 'BASE', 'kern', 'GASP', 'vhea', 'vmtx', 'VORG', 'JSTF']
    options.ignore_missing_glyphs = True
    options.ignore_missing_unicodes = True

    font = load_font(str(source), options)
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=sorted(codepoints), glyphs=EXTRA_GLYPH_NAMES)
    subsetter.subset(font)
    save_font(font, str(target), options)
    font.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jsx', type=Path,
                        default=REPO_ROOT / 'components' / 'checkup' / 'create_pdf.tsx',
                        help='Source JSX whose literal characters must be kept.')
    args = parser.parse_args()

    if not SOURCE_DIR.exists():
        sys.exit(f'Source font dir not found: {SOURCE_DIR}\n'
                 f'Run `npm install --save-dev @fontsource/noto-sans-jp` first.')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    codepoints: set[int] = set()
    for low, high in UNICODE_RANGES:
        codepoints.update(range(low, high + 1))
    codepoints.update(chars_from_jsx(args.jsx))
    print(f'Keeping {len(codepoints):,} codepoints '
          f'(+{len(EXTRA_GLYPH_NAMES)} explicit glyphs).')

    for weight, label in WEIGHTS:
        source = SOURCE_DIR / f'noto-sans-jp-japanese-{weight}-normal.woff2'
        target = OUTPUT_DIR / f'noto-jp-report-{label}.ttf'
        if not source.exists():
            sys.exit(f'Missing source file: {source}')

        # subsetter wants a TTF/OTF input. The @fontsource bundle ships WOFF2;
        # `load_font` decompresses transparently when fontTools[woff] is
        # available. If the woff2 codec is missing the error message points
        # the user at `pip install 'fonttools[woff]'`.
        before = source.stat().st_size
        build_subset(source, target, codepoints)
        after = target.stat().st_size
        pct = (1 - after / before) * 100 if before else 0
        print(f'  {label}: {before/1024:,.0f} KB → {after/1024:,.0f} KB '
              f'(-{pct:.0f}%)  {target.relative_to(REPO_ROOT)}')

    print('\nNext: ensure `Font.register` in components/checkup/create_pdf.tsx '
          'points at /fonts/noto-jp-report-{regular,bold}.ttf and that the '
          'preload useEffect uses the same URLs.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
