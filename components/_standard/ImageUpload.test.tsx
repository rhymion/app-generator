import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('offers no file upload: the value is a URL', () => {
    render(<ImageUpload value="" onChange={vi.fn()} />);
    expect(screen.queryByText('Upload')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('renders default helper text', () => {
    render(<ImageUpload value="" onChange={vi.fn()} />);
    expect(screen.getByText('You can paste a URL')).toBeInTheDocument();
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
});
