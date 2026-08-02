import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MentionInput from './MentionInput';
import type { MentionUserOption } from './MentionInput';

const alice: MentionUserOption = { id: 'u1', name: 'Alice', email: 'alice@example.com' };
const bob: MentionUserOption = { id: 'u2', name: 'Bob', email: 'bob@example.com' };

// MentionInput is a controlled component (value/onChange) — a thin
// stateful wrapper lets tests type into it and observe the resulting value,
// the same way the generated MentionInput/comment textarea usage does.
type SearchFn = (q: string) => Promise<MentionUserOption[] & { permissionDenied?: boolean }>;

function Controlled({ initial = '', searchUsers }: { initial?: string; searchUsers: SearchFn }) {
  const [value, setValue] = useState(initial);
  return <MentionInput label="Message" value={value} onChange={setValue} searchUsers={searchUsers} debounceMs={10} />;
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a labeled multiline text field with no dropdown initially', () => {
    const searchUsers = vi.fn().mockResolvedValue([]);
    render(<Controlled searchUsers={searchUsers} />);
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('opens the dropdown and calls searchUsers with the query after typing "@word"', async () => {
    const searchUsers = vi.fn().mockResolvedValue([alice, bob]);
    render(<Controlled searchUsers={searchUsers} />);
    const input = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hi @al', selectionStart: 6 } });
    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('al'));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('inserts the @[user_id:<id>] marker and closes the dropdown on selecting a candidate', async () => {
    const searchUsers = vi.fn().mockResolvedValue([alice]);
    render(<Controlled searchUsers={searchUsers} />);
    const input = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hi @al', selectionStart: 6 } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => expect(input.value).toBe('Hi @[user_id:u1] '));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('does not treat an email-like "@" (no preceding whitespace) as a mention trigger', () => {
    const searchUsers = vi.fn().mockResolvedValue([alice]);
    render(<Controlled searchUsers={searchUsers} />);
    const input = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'user@example.com', selectionStart: 17 } });
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it('shows a non-crashing "unavailable" message instead of candidates when permissionDenied is true', async () => {
    const searchUsers = vi.fn().mockResolvedValue(Object.assign([], { permissionDenied: true }));
    render(<Controlled searchUsers={searchUsers} />);
    const input = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hi @al', selectionStart: 6 } });
    await waitFor(() =>
      expect(screen.getByText('Mention suggestions unavailable.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    const searchUsers = vi.fn().mockResolvedValue([]);
    render(
      <MentionInput label="Message" value="" onChange={vi.fn()} searchUsers={searchUsers} disabled />,
    );
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('renders required attribute when required=true', () => {
    const searchUsers = vi.fn().mockResolvedValue([]);
    render(
      <MentionInput label="Message" value="" onChange={vi.fn()} searchUsers={searchUsers} required />,
    );
    expect(screen.getByLabelText(/Message/)).toBeRequired();
  });
});
