'use client';

// Renders @[user_id:<id>] mention markers (mention_parser.ts) as styled
// spans/links (cmd_522c). Always present regardless of schema (like
// EntityAutocomplete/CommentListWrapper) — never imports anything from
// lib/mention/* (only generated when the schema has ≥1 x-mention: true
// field), so a zero-mention schema never pulls in this component's
// dependency chain by way of the surrounding boilerplate.
//
// `text` must be the RAW stored string (markers intact) — the comment
// getter no longer decodes @[user_id:<id>] to a plain name server-side
// (cmd_522c; see api_detail_route.ts.jinja2 for the one place that still
// decodes, for the REST API's plain-text JSON contract). `userContext` maps
// id → display name for the names this component itself resolves. A
// mentioned id absent from userContext (anonymized/deleted user) falls back
// to the translated Common.deletedUser label — no crash, no raw id leak.

import { useTranslations } from 'next-intl';

const MENTION_PATTERN = /@\[user_id:([^\]]+)\]/g;

interface MentionTextProps {
  /** Raw stored text with @[user_id:<id>] markers intact. */
  text: string;
  /** Maps mentioned user id → display name. */
  userContext: Record<string, string>;
  /** Whether the viewer may link mentioned users' names to their profile
   *  page (false when the viewer lacks read permission on the user model —
   *  cmd_516 Option B graceful degradation). */
  canViewUserProfile: boolean;
}

export default function MentionText({ text, userContext, canViewUserProfile }: MentionTextProps) {
  const tc = useTranslations('Common');
  const deletedUserLabel = tc('deletedUser');
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const id = match[1];
    const name = userContext[id] ?? deletedUserLabel;
    parts.push(
      canViewUserProfile && userContext[id] ? (
        <a key={`mention-${key++}`} href={`/user/view/${id}`} className="mention-link">
          @{name}
        </a>
      ) : (
        <span key={`mention-${key++}`} className="mention-chip">
          @{name}
        </span>
      ),
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
