// Mention parser utilities for @[user_id:<id>] syntax (GDPR-safe mention pattern).
// Stores user references as IDs, not plaintext names, to support right-to-erasure.

// Matches any non-`]` id payload rather than a fixed format (e.g. UUID) so it
// works with the actual user.id scheme (cuid2, via @paralleldrive/cuid2's
// createId()) without hardcoding its length/charset, and keeps working if the
// id scheme changes again later.
const MENTION_PATTERN = /@\[user_id:([^\]]+)\]/g;

/** Maps display name (or @handle) to user id and name. */
export type UserLookup = Record<string, { id: string; name: string }>;

/** Maps user id to display name for rendering. */
export type UserContext = Record<string, string>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @deprecated (cmd_522) No longer called from the save path. The client-side
 * MentionInput picker inserts @[user_id:<id>] markers directly into the
 * textarea value, so add/updateXxxComment() actions store the raw client
 * text unchanged — inference by longest-name-first matching is no longer
 * needed there. Kept for backward compatibility (any out-of-generator code
 * that may still reference it) and for unit tests exercising the inference
 * logic directly. Hand-typed "@Jane" (bypassing the picker) is stored as
 * literal text and will NOT be encoded or matched by decodeMentions().
 *
 * Converts @username patterns to @[user_id:<id>] storage format before saving to DB.
 * Matches against the known display names in userLookup directly (rather than a
 * fixed [\w.]+ charset) so names containing non-ASCII characters (e.g. Japanese)
 * or spaces are recognized. Names are tried longest-first so a shorter name that
 * is a prefix of a longer one never shadows it. The trailing-boundary check only
 * excludes ASCII word characters ([A-Za-z0-9_]); it deliberately does not apply
 * to CJK text, since Japanese names are routinely followed by honorifics/particles
 * (e.g. "@田中太郎さん") with no delimiting character, and rejecting that would
 * reintroduce the same non-ASCII-name failure this fix addresses. Names not found
 * in userLookup are left unchanged.
 */
export function encodeMentions(text: string, userLookup: UserLookup): string {
  const names = Object.keys(userLookup)
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const pattern = new RegExp(
    `@(${names.map(escapeRegExp).join('|')})(?!\\w)`,
    'gu'
  );
  return text.replace(pattern, (match, name) => {
    const user = userLookup[name];
    return user ? `@[user_id:${user.id}]` : match;
  });
}

/**
 * Converts @[user_id:uuid] storage format to display names for rendering.
 * If userId is absent from context (user anonymized/deleted), falls back to
 * deletedUserLabel — pass the translated value of the `Common.deletedUser`
 * i18n key (e.g. `t('deletedUser')` from `useTranslations('Common')` or
 * `getTranslations('Common')`, depending on the caller's component type).
 */
export function decodeMentions(text: string, context: UserContext, deletedUserLabel: string): string {
  return text.replace(MENTION_PATTERN, (_, userId) => {
    const name = context[userId];
    return `@${name ?? deletedUserLabel}`;
  });
}

/**
 * Extracts all mentioned user IDs from a text string.
 * Returns deduplicated list of user ids.
 */
export function extractMentionedUserIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}
