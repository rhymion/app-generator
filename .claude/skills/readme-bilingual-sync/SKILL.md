---
name: readme-bilingual-sync
description: Skill for checking and enforcing sync between README.md (English) and README_ja.md (Japanese). Use whenever a README change is made, to make sure both language versions are updated together. Triggers on "update README", "sync README", "readme sync".
---

# readme-bilingual-sync - README EN/JA Sync

## Overview

Detects drift between README.md (English) and README_ja.md (Japanese) —
missing sections, and section-number misalignment — and fixes them.

Workflow when README changes:
1. Detect drift (auto-determine which file is ahead)
2. List missing sections
3. Translate and append the missing content
4. Check that section numbering stays consistent across both files

## When to Use

- After editing a README (new feature, new section, structural change)
- When told "update README", "sync README", "readme sync"
- After writing a new feature into the English README and being told "the
  Japanese version too"
- As a README consistency check before opening a PR

## Instructions

### Step 1: Detect drift

Read both files and check for drift along these dimensions:

```bash
# Read both files
Read README.md
Read README_ja.md
```

**Checklist:**

| Item | How to verify |
|------|----------|
| Section count | Do the `###` headers match in count? |
| Section numbering | Are numbered sections (`### ... 1.`, `### ... 2.`, etc.) sequential and matching? |
| File structure listing | Does the File Structure section's file list match between both? |
| "What's New" section | Does a changelog-style section exist in both? |
| Collapsible blocks | Do `<details>` blocks match in presence/absence? |

### Step 2: Report the drift

Report the detected drift, e.g.:

```
README sync check results:

Missing in JA (present in EN):
- Section "Installation" missing from the Japanese version
- lib/cli.sh not listed in the file structure section
- The v3.3.2 section is missing

Missing in EN (present in JA):
- (none)

Section numbering drift:
- JA: "Configuration" is numbered 5, EN has it as 6
```

### Step 3: Apply the sync

Fix the drift. Example translation table (replace with your own project's
section names):

| EN | JA |
|----|-----|
| Installation | インストール |
| Usage | 使い方 |
| Configuration | 設定 |
| Contributing | コントリビューション |
| Architecture Overview | アーキテクチャ概要 |
| Getting Started | はじめに |
| API Reference | APIリファレンス |
| Troubleshooting | トラブルシューティング |
| License | ライセンス |

**Translation policy:**
- Keep technical terms as-is (CLI, API, YAML, npm, etc.)
- Do not translate commands inside code blocks
- Keep example output aligned with the target language's conventions
- Reuse the same emoji as the English version

### Step 4: Final consistency check

After fixing, confirm:
1. Section counts match between both files
2. Numbered sections are sequential and aligned
3. File structure section entries match
4. The changelog/"What's New" section exists in both

## Guidelines

- **EN is the source of truth**: new features are written in English first;
  the Japanese version follows
- **Preserve JA-specific phrasing**: idiomatic Japanese wording already in
  README_ja.md should be kept as-is rather than forced into a literal
  translation
- **Not one-directional**: check for EN-only changes AND JA-only changes —
  either file may have drifted ahead
- **Renumber automatically**: when a section is inserted in the middle,
  renumber every subsequent section
- **Leave code blocks alone**: text inside bash/yaml/markdown code blocks is
  never a translation target
