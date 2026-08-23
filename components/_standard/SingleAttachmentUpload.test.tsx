import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SingleAttachmentUpload from './SingleAttachmentUpload';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string) => key,
}));

describe('SingleAttachmentUpload — mode="url" (cmd_776(3))', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders upload button and default helper text', () => {
    render(<SingleAttachmentUpload mode="url" kind="file" value="" onChange={vi.fn()} />);
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('You can upload a file')).toBeInTheDocument();
  });

  it('calls onChange with the uploaded URL on successful upload', async () => {
    const onChange = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/uploaded.pdf' }),
    } as Response);

    render(<SingleAttachmentUpload mode="url" kind="file" value="" onChange={onChange} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'contract.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('https://cdn.example.com/uploaded.pdf');
    });
  });

  it('renders a download link (not an <img>) once a file kind value is set', () => {
    render(<SingleAttachmentUpload mode="url" kind="file" value="https://example.com/contract.pdf" onChange={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/contract.pdf');
  });

  it('renders an <img> preview once an image kind value is set', () => {
    render(<SingleAttachmentUpload mode="url" kind="image" value="https://example.com/photo.png" onChange={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('clears the value when Remove is clicked', () => {
    const onChange = vi.fn();
    render(<SingleAttachmentUpload mode="url" kind="file" value="https://example.com/contract.pdf" onChange={onChange} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not render Remove when no value is set', () => {
    render(<SingleAttachmentUpload mode="url" kind="file" value="" onChange={vi.fn()} />);
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });
});

describe('SingleAttachmentUpload — mode="fk" (cmd_788)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('uploads the file then creates the attachment row and calls onChange with the descriptor', async () => {
    const onChange = vi.fn();
    const createAttachment = vi.fn().mockResolvedValue({
      id: 'att_1',
      name: 'photo.png',
      path: 'https://cdn.example.com/uploaded.png',
      type: 'image',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/uploaded.png' }),
    } as Response);

    render(<SingleAttachmentUpload mode="fk" value={null} onChange={onChange} createAttachment={createAttachment} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(createAttachment).toHaveBeenCalledWith('photo.png', 'https://cdn.example.com/uploaded.png', 'image');
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        id: 'att_1',
        name: 'photo.png',
        path: 'https://cdn.example.com/uploaded.png',
        type: 'image',
      });
    });
  });

  it('renders the current attachment (name, not raw path) when value is set', () => {
    render(
      <SingleAttachmentUpload
        mode="fk"
        value={{ id: 'att_1', name: 'contract.pdf', path: 'https://cdn.example.com/x/uuid.pdf', type: 'file' }}
        onChange={vi.fn()}
        createAttachment={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'contract.pdf' })).toHaveAttribute(
      'href',
      'https://cdn.example.com/x/uuid.pdf',
    );
  });

  it('calls onChange(null) when Remove is clicked', () => {
    const onChange = vi.fn();
    render(
      <SingleAttachmentUpload
        mode="fk"
        value={{ id: 'att_1', name: 'contract.pdf', path: 'https://cdn.example.com/x/uuid.pdf', type: 'file' }}
        onChange={onChange}
        createAttachment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Remove'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows an error and does not call onChange when the attachment row creation fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/uploaded.png' }),
    } as Response);
    const createAttachment = vi.fn().mockRejectedValue(new Error('permission denied'));

    const onChange = vi.fn();
    render(<SingleAttachmentUpload mode="fk" value={null} onChange={onChange} createAttachment={createAttachment} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('permission denied')).toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
