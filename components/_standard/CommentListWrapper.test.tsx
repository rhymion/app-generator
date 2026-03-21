import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import CommentListWrapper from './CommentListWrapper';

const comment1 = {
  id: 'c1',
  message: 'Hello world',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
  creator: { id: 'user1', name: 'Alice' },
};
const comment2 = {
  id: 'c2',
  message: 'Another comment',
  created_at: '2024-01-02T10:00:00Z',
  updated_at: '2024-01-02T10:00:00Z',
  creator: { id: 'user2', name: 'Bob' },
};

describe('CommentListWrapper', () => {
  describe('Read (display)', () => {
    it('shows empty state with 0 comments', () => {
      render(<CommentListWrapper comments={[]} />);
      expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    });

    it('shows 1 comment with message and creator name', () => {
      render(<CommentListWrapper comments={[comment1]} />);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('shows multiple comments', () => {
      render(<CommentListWrapper comments={[comment1, comment2]} />);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.getByText('Another comment')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('shows default title "Comments"', () => {
      render(<CommentListWrapper comments={[]} />);
      expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    });

    it('hides title when showTitle=false', () => {
      render(<CommentListWrapper comments={[]} showTitle={false} />);
      expect(screen.queryByRole('heading', { name: 'Comments' })).not.toBeInTheDocument();
    });

    it('shows custom title', () => {
      render(<CommentListWrapper comments={[]} title="Notes" />);
      expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });

    it('shows creator initials avatar when no avatar image', () => {
      const commentWithTwoNames = {
        ...comment1,
        creator: { id: 'user1', name: 'Alice Lee' },
      };
      render(<CommentListWrapper comments={[commentWithTwoNames]} />);
      expect(screen.getByText('AL')).toBeInTheDocument();
    });

    it('shows "edited" indicator when comment was updated later', () => {
      const editedComment = {
        ...comment1,
        updated_at: '2024-01-01T11:00:00Z', // 1 hour after created_at
      };
      render(<CommentListWrapper comments={[editedComment]} />);
      expect(screen.getByText(/Edited:/)).toBeInTheDocument();
    });

    it('does not show "edited" indicator when timestamps are equal', () => {
      render(<CommentListWrapper comments={[comment1]} />);
      expect(screen.queryByText(/Edited:/)).not.toBeInTheDocument();
    });
  });

  describe('Update (edit comment)', () => {
    it('does not show edit button for a different user (non-creator)', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user2"
          permissions={{ create: true, delete: true }}
          onUpdateComment={vi.fn()}
        />
      );
      expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    });

    it('shows edit button for the comment creator when permissions.delete=true', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={vi.fn()}
        />
      );
      expect(screen.getByLabelText('Edit')).toBeInTheDocument();
    });

    it('does not show edit button even for creator when permissions.delete=false', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: false }}
          onUpdateComment={vi.fn()}
        />
      );
      expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    });

    it('does not show edit button when onUpdateComment is not provided', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
        />
      );
      expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    });

    it('shows edit button only for own comments when multiple comments are shown', () => {
      render(
        <CommentListWrapper
          comments={[comment1, comment2]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={vi.fn()}
        />
      );
      expect(screen.getAllByLabelText('Edit')).toHaveLength(1);
    });

    it('shows textarea pre-filled with current message when edit is clicked', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={vi.fn()}
        />
      );
      fireEvent.click(screen.getByLabelText('Edit'));
      expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument();
    });

    it('calls onUpdateComment with the new message on save', async () => {
      const onUpdateComment = vi.fn().mockResolvedValue(undefined);
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={onUpdateComment}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByDisplayValue('Hello world'), {
        target: { value: 'Updated message' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onUpdateComment).toHaveBeenCalledWith('c1', 'Updated message');
      });
    });

    it('does not call onUpdateComment when save is clicked with blank message', () => {
      const onUpdateComment = vi.fn();
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={onUpdateComment}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByDisplayValue('Hello world'), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onUpdateComment).not.toHaveBeenCalled();
    });

    it('reverts to original message when cancel is clicked', () => {
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByDisplayValue('Hello world'), {
        target: { value: 'Changed message' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Changed message')).not.toBeInTheDocument();
    });

    it('exits edit mode after successful save', async () => {
      const onUpdateComment = vi.fn().mockResolvedValue(undefined);
      render(
        <CommentListWrapper
          comments={[comment1]}
          currentUserId="user1"
          permissions={{ create: true, delete: true }}
          onUpdateComment={onUpdateComment}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.queryByDisplayValue('Hello world')).not.toBeInTheDocument();
      });
    });
  });
});
