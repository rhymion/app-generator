'use client';

import { Fragment, useState, useTransition } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import type { ModelPermissions } from '@/lib/authz';
import CommentReactionBar from '@/components/_standard/CommentReactionBar';
import type { CommentReactionSummary, ReactionType } from '@/components/_standard/CommentReactionBar';
import MentionInput, { type MentionSearchFn } from '@/components/_standard/MentionInput';

export type CommentItem = {
  id: string;
  message: string;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  creator?: {
    id: string;
    name: string;
    image?: string | null;
  } | null;
  reactionCounts?: Array<{ type: string | number; count: number }>;
  myReactionTypes?: (string | number)[];
};

interface CommentListWrapperProps {
  comments: CommentItem[];
  /** ID of the currently logged-in user. Used to show Edit/Delete on own comments. */
  currentUserId?: string | null;
  permissions?: Pick<ModelPermissions, 'create' | 'delete'>;
  title?: string;
  showTitle?: boolean;
  onCreateComment?: (message: string) => Promise<void>;
  onUpdateComment?: (id: string, message: string) => Promise<void>;
  onDeleteComment?: (id: string) => Promise<void>;
  reactionTypes?: ReactionType[];
  onToggleReaction?: (commentId: string, type: string | number) => Promise<CommentReactionSummary>;
  /**
   * Renders a comment's message body. Defaults to plain text. Pass this to
   * enable mention-aware rendering (cmd_522) — this component imports
   * MentionText directly (`@/components/_standard/MentionText`, itself an
   * always-present static component like this one — see its own file for why
   * that's schema-safe), so callers don't need to pass the component itself,
   * only the render-prop that supplies each comment's `userContext`/
   * `canViewUserProfile` (those two are schema/permission-conditional, this
   * component never computes them).
   */
  renderMessage?: (comment: CommentItem) => React.ReactNode;
  /**
   * Enables the @mention candidate picker (cmd_538) in both the new-comment
   * compose box and the per-comment edit box, by swapping the plain
   * multiline TextField for `MentionInput`. Generated per-entity code passes
   * the schema-generated `searchMentionUserOptions` here (same
   * dependency-injection pattern `form_upsert_context()` already uses for an
   * entity's own `x-mention` fields) — this component itself never imports
   * `lib/mention/search` (schema-conditional), only the always-present
   * `MentionInput` component, so a schema with zero mentions never triggers
   * `searchMentionUserOptions` in this component's dependency graph (it's
   * simply never passed, `searchUsers` stays undefined, and the plain
   * TextField path is used below).
   */
  searchUsers?: MentionSearchFn;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString();
}

interface CommentItemComponentProps {
  comment: CommentItem;
  isCreator: boolean;
  canDelete: boolean;
  onUpdate?: (id: string, message: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  reactionTypes?: ReactionType[];
  onToggleReaction?: (commentId: string, type: string | number) => Promise<CommentReactionSummary>;
  renderMessage?: (comment: CommentItem) => React.ReactNode;
  searchUsers?: MentionSearchFn;
}

function CommentItemComponent({ comment, canDelete, onUpdate, onDelete, reactionTypes, onToggleReaction, renderMessage, searchUsers }: CommentItemComponentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editMessage, setEditMessage] = useState(comment.message);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!onUpdate || !editMessage.trim()) return;
    startTransition(async () => {
      await onUpdate(comment.id, editMessage.trim());
      setIsEditing(false);
    });
  };

  const handleCancel = () => {
    setEditMessage(comment.message);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!onDelete) return;
    startTransition(async () => {
      await onDelete(comment.id);
    });
  };

  const creatorName = comment.creator?.name ?? 'Unknown';
  const avatarSrc = comment.creator?.image ?? undefined;
  const wasEdited =
    comment.created_at &&
    comment.updated_at &&
    new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1000;

  return (
    <ListItem alignItems="flex-start" sx={{ px: 0 }}>
      <Box sx={{ display: 'flex', width: '100%', gap: 2 }}>
        <Avatar src={avatarSrc} sx={{ width: 40, height: 40, mt: 0.5, flexShrink: 0 }}>
          {!avatarSrc && getInitials(creatorName)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5, gap: 1 }}>
            <Typography variant="subtitle2" noWrap sx={{
              fontWeight: "bold"
            }}>
              {creatorName}
            </Typography>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              {comment.created_at && (
                <Typography
                  variant="caption"
                  suppressHydrationWarning
                  sx={{
                    color: "text.secondary",
                    display: "block"
                  }}>
                  {formatDate(comment.created_at)}
                </Typography>
              )}
              {wasEdited && comment.updated_at && (
                <Typography
                  variant="caption"
                  suppressHydrationWarning
                  sx={{
                    color: "text.secondary",
                    display: "block"
                  }}>
                  Edited: {formatDate(comment.updated_at)}
                </Typography>
              )}
            </Box>
          </Box>
          {isEditing ? (
            <>
              {searchUsers ? (
                <MentionInput
                  value={editMessage}
                  onChange={setEditMessage}
                  searchUsers={searchUsers}
                  rows={3}
                  disabled={isPending}
                />
              ) : (
                <TextField
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                  size="small"
                  disabled={isPending}
                />
              )}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 1 }}>
                <Tooltip title="Cancel">
                  <IconButton size="small" onClick={handleCancel} disabled={isPending} aria-label="Cancel">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Save">
                  <span>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={handleSave}
                      disabled={isPending || !editMessage.trim()}
                      aria-label="Save"
                    >
                      <SaveIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {renderMessage ? renderMessage(comment) : comment.message}
              </Typography>
              {reactionTypes && reactionTypes.length > 0 && onToggleReaction && (
                <CommentReactionBar
                  commentId={comment.id}
                  counts={comment.reactionCounts ?? []}
                  myTypes={comment.myReactionTypes ?? []}
                  onToggle={(type) => onToggleReaction(comment.id, type)}
                  types={reactionTypes}
                />
              )}
              {(canDelete) && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 0.5 }}>
                  {canDelete && onUpdate && (
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setIsEditing(true)} disabled={isPending} aria-label="Edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {canDelete && onDelete && (
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={handleDelete} disabled={isPending} aria-label="Delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </ListItem>
  );
}

export default function CommentListWrapper({
  comments,
  currentUserId,
  permissions = { create: true, delete: true },
  title = 'Comments',
  showTitle = true,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  reactionTypes,
  onToggleReaction,
  renderMessage,
  searchUsers,
}: CommentListWrapperProps) {
  const [newMessage, setNewMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!onCreateComment || !newMessage.trim()) return;
    startTransition(async () => {
      await onCreateComment(newMessage.trim());
      setNewMessage('');
    });
  };

  return (
    <div>
      {showTitle && <h2>{title}</h2>}
      <Paper sx={{ p: 2 }}>
        <List disablePadding>
          {comments.length === 0 ? (
            <ListItem sx={{ px: 0 }}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                No comments yet.
              </Typography>
            </ListItem>
          ) : (
            comments.map((comment, index) => (
              <Fragment key={comment.id}>
                <CommentItemComponent
                  comment={comment}
                  isCreator={!!currentUserId && comment.creator?.id === currentUserId}
                  canDelete={permissions.delete && comment.creator?.id === currentUserId}
                  onUpdate={onUpdateComment}
                  onDelete={onDeleteComment}
                  reactionTypes={reactionTypes}
                  onToggleReaction={onToggleReaction}
                  renderMessage={renderMessage}
                  searchUsers={searchUsers}
                />
                {index < comments.length - 1 && <Divider component="li" />}
              </Fragment>
            ))
          )}
        </List>
        {permissions.create && onCreateComment && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {searchUsers ? (
                  <MentionInput
                    value={newMessage}
                    onChange={setNewMessage}
                    searchUsers={searchUsers}
                    placeholder="Write a comment..."
                    rows={2}
                    disabled={isPending}
                  />
                ) : (
                  <TextField
                    placeholder="Write a comment..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    fullWidth
                    multiline
                    rows={2}
                    size="small"
                    disabled={isPending}
                  />
                )}
              </Box>
              <Tooltip title="Submit">
                <span>
                  <IconButton
                    color="primary"
                    onClick={handleCreate}
                    disabled={isPending || !newMessage.trim()}
                    aria-label="Submit"
                    sx={{ flexShrink: 0, mt: 0.5 }}
                  >
                    <SendIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </>
        )}
      </Paper>
    </div>
  );
}
