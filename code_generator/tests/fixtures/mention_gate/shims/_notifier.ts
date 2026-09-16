// Fixture-only stand-in for @/lib/_notifier (cmd_538, extending
// the mention-gate check to cover FormUpsert.tsx / actions.ts).
// The comment-actions code (_build_comment_actions/_build_comment_actions_
// bridge) calls notify() unconditionally whenever a comment thread exists --
// only pulled into this gate's compile graph now that actions.ts (imported
// transitively by FormUpsert.tsx) is in scope. Same rationale as authz.ts in
// this directory: the real implementation imports the generated Prisma
// client's `Prisma` namespace type (@/app/generated/prisma/client), which
// this fixture's isolated prisma generate output doesn't expose at that
// import path, and pulls in the full production `notification` model --
// unrelated to what this gate checks.
export type NotificationType =
  | 'assigned'
  | 'approval_requested'
  | 'approval_responded'
  | 'comment_created'
  | string;

export interface NotificationPayload {
  title: string;
  href?: string;
  [key: string]: unknown;
}

export function notify(
  _userId: string,
  _type: NotificationType,
  _payload: NotificationPayload,
): void {
  throw new Error('fixture stub');
}
