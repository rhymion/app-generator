// Mention parser utilities for @[user_id:uuid] syntax (GDPR-safe mention pattern).
// Stores user references as IDs, not plaintext names, to support right-to-erasure.

const MENTION_PATTERN = /@\[user_id:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
const AT_NAME_PATTERN = /@([\w.]+)/g;

/** Maps display name (or @handle) to user id and name. */
export type UserLookup = Record<string, { id: string; name: string }>;

/** Maps user id to display name for rendering. */
export type UserContext = Record<string, string>;

/**
 * Converts @username patterns to @[user_id:uuid] storage format before saving to DB.
 * Names not found in userLookup are left unchanged.
 */
export function encodeMentions(text: string, userLookup: UserLookup): string {
  return text.replace(AT_NAME_PATTERN, (match, name) => {
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
 * Returns deduplicated list of UUIDs.
 */
export function extractMentionedUserIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}
