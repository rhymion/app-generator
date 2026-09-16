import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import MentionText from './MentionText';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string) => key,
}));

describe('MentionText', () => {
  it('renders plain text with no mention markers unchanged', () => {
    render(<MentionText text="Hello world" userContext={{}} canViewUserProfile={false} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders a mention as a profile link when canViewUserProfile is true and the user is known', () => {
    render(
      <MentionText
        text="Hi @[user_id:u1], see this."
        userContext={{ u1: 'Alice' }}
        canViewUserProfile
      />,
    );
    const link = screen.getByRole('link', { name: '@Alice' });
    expect(link).toHaveAttribute('href', '/user/view/u1');
    expect(link).toHaveClass('mention-link');
  });

  it('renders a mention as a non-link chip when canViewUserProfile is false', () => {
    render(
      <MentionText
        text="Hi @[user_id:u1]"
        userContext={{ u1: 'Alice' }}
        canViewUserProfile={false}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const chip = screen.getByText('@Alice');
    expect(chip).toHaveClass('mention-chip');
  });

  it('falls back to the deletedUser label (no crash) when the mentioned id is absent from userContext', () => {
    render(<MentionText text="Hi @[user_id:gone]" userContext={{}} canViewUserProfile />);
    // Mocked next-intl returns the raw key — the untranslated 'deletedUser' string.
    expect(screen.getByText('@deletedUser')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders multiple mentions and interleaved plain text correctly', () => {
    render(
      <MentionText
        text="cc @[user_id:u1] and @[user_id:u2] please"
        userContext={{ u1: 'Alice', u2: 'Bob' }}
        canViewUserProfile
      />,
    );
    expect(screen.getByText(/cc/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@Alice' })).toHaveAttribute('href', '/user/view/u1');
    expect(screen.getByRole('link', { name: '@Bob' })).toHaveAttribute('href', '/user/view/u2');
    expect(screen.getByText(/please/)).toBeInTheDocument();
  });
});
