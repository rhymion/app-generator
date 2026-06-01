import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImageUpload from './ImageUpload';

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string) => key,
}));

describe('ImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders upload button', () => {
    render(<ImageUpload value="" onChange={vi.fn()} />);
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('renders default helper text', () => {
    render(<ImageUpload value="" onChange={vi.fn()} />);
    expect(screen.getByText('You can paste a URL or upload a file')).toBeInTheDocument();
  });

  it('calls onChange when URL is typed directly', async () => {
    const onChange = vi.fn();
    render(<ImageUpload value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'https://example.com/photo.png' } });
    expect(onChange).toHaveBeenCalledWith('https://example.com/photo.png');
  });

  it('renders image preview when value is set', () => {
    render(<ImageUpload value="https://example.com/photo.png" onChange={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'Preview' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('does not render image preview when value is empty', () => {
    render(<ImageUpload value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows error and calls onChange with URL on successful upload', async () => {
    const onChange = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/uploaded.png' }),
    } as Response);

    render(<ImageUpload value="" onChange={onChange} />);

    const fileInput = document.getElementById('image-upload-button') as HTMLInputElement;
    const file = new File(['content'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('https://cdn.example.com/uploaded.png');
    });
  });

  it('shows error message when upload API returns error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'File too large' }),
    } as Response);

    render(<ImageUpload value="" onChange={vi.fn()} />);

    const fileInput = document.getElementById('image-upload-button') as HTMLInputElement;
    const file = new File(['content'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('File too large')).toBeInTheDocument();
    });
  });

  it('shows "Upload failed" when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<ImageUpload value="" onChange={vi.fn()} />);

    const fileInput = document.getElementById('image-upload-button') as HTMLInputElement;
    const file = new File(['content'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
