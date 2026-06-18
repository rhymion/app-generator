import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import CommentReactionBar from './CommentReactionBar';
import type { CommentReactionSummary, ReactionType } from './CommentReactionBar';
import CommentListWrapper from './CommentListWrapper';

const REACTION_TYPES: ReactionType[] = [
  { value: 0, label: 'Like' },
  { value: 1, label: 'Celebrate' },
  { value: 2, label: 'Helpful' },
];

const makeSummary = (active: boolean, type: number, myTypes: number[]): CommentReactionSummary => ({
  commentId: 'c1',
  type,
  active,
  counts: myTypes.map((t) => ({ type: t, count: 1 })),
  myTypes,
});

describe('CommentReactionBar', () => {
  it('renders all reaction type buttons', () => {
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[]}
        myTypes={[]}
        onToggle={vi.fn()}
        types={REACTION_TYPES}
      />
    );
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Celebrate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
  });

  it('shows count next to button when count > 0', () => {
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[{ type: 0, count: 3 }]}
        myTypes={[]}
        onToggle={vi.fn()}
        types={REACTION_TYPES}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('active types use contained variant (aria-pressed=true)', () => {
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[{ type: 0, count: 1 }]}
        myTypes={[0]}
        onToggle={vi.fn()}
        types={REACTION_TYPES}
      />
    );
    const likeBtn = screen.getByRole('button', { name: 'Like' });
    expect(likeBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('inactive types have aria-pressed=false', () => {
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[]}
        myTypes={[]}
        onToggle={vi.fn()}
        types={REACTION_TYPES}
      />
    );
    const likeBtn = screen.getByRole('button', { name: 'Like' });
    expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('multiple active types can coexist independently', () => {
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[{ type: 0, count: 1 }, { type: 1, count: 1 }]}
        myTypes={[0, 1]}
        onToggle={vi.fn()}
        types={REACTION_TYPES}
      />
    );
    expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Celebrate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the correct type when a button is clicked', async () => {
    const onToggle = vi.fn().mockResolvedValue(makeSummary(true, 0, [0]));
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[]}
        myTypes={[]}
        onToggle={onToggle}
        types={REACTION_TYPES}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(0));
  });

  it('disables only the pending button while onToggle is in progress', async () => {
    let resolveToggle!: (v: CommentReactionSummary) => void;
    const onToggle = vi.fn().mockImplementation(
      () => new Promise<CommentReactionSummary>((res) => { resolveToggle = res; })
    );
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[]}
        myTypes={[]}
        onToggle={onToggle}
        types={REACTION_TYPES}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    // Like should be disabled; Celebrate should still be enabled
    expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Celebrate' })).not.toBeDisabled();
    resolveToggle(makeSummary(true, 0, [0]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).not.toBeDisabled());
  });

  it('updates counts and myTypes locally after successful toggle', async () => {
    const onToggle = vi.fn().mockResolvedValue(makeSummary(true, 0, [0]));
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[]}
        myTypes={[]}
        onToggle={onToggle}
        types={REACTION_TYPES}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('reverts to previous state when onToggle throws', async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error('Network error'));
    render(
      <CommentReactionBar
        commentId="c1"
        counts={[{ type: 0, count: 2 }]}
        myTypes={[0]}
        onToggle={onToggle}
        types={REACTION_TYPES}
      />
    );
    // Initially active
    expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    // After failure, should revert to active
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'true')
    );
  });

  describe('CommentListWrapper integration', () => {
    const commentWithReactions = {
      id: 'c1',
      message: 'Hello',
      created_at: '2024-01-01T10:00:00Z',
      updated_at: '2024-01-01T10:00:00Z',
      creator: { id: 'user1', name: 'Alice' },
      reactionCounts: [{ type: 0, count: 1 }],
      myReactionTypes: [0],
    };

    it('renders CommentReactionBar inside CommentListWrapper when reactionTypes provided', () => {
      render(
        <CommentListWrapper
          comments={[commentWithReactions]}
          reactionTypes={REACTION_TYPES}
          onToggleReaction={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    });

    it('calls onToggleReaction with commentId and type when reaction button clicked', async () => {
      const onToggleReaction = vi.fn().mockResolvedValue(makeSummary(false, 0, []));
      render(
        <CommentListWrapper
          comments={[commentWithReactions]}
          reactionTypes={REACTION_TYPES}
          onToggleReaction={onToggleReaction}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Like' }));
      await waitFor(() =>
        expect(onToggleReaction).toHaveBeenCalledWith('c1', 0)
      );
    });

    it('does not render CommentReactionBar when reactionTypes not provided', () => {
      render(<CommentListWrapper comments={[commentWithReactions]} />);
      expect(screen.queryByRole('button', { name: 'Like' })).not.toBeInTheDocument();
    });
  });
});
