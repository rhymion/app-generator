import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SingleAttachmentDisplay from './SingleAttachmentDisplay';

describe('SingleAttachmentDisplay', () => {
  it('renders nothing when url is null', () => {
    const { container } = render(<SingleAttachmentDisplay url={null} kind="image" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an <img> for kind=image', () => {
    render(<SingleAttachmentDisplay url="https://example.com/photo.png" kind="image" alt="Photo" />);
    const img = screen.getByRole('img', { name: 'Photo' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('renders a download link (not an <img>) for kind=file', () => {
    render(<SingleAttachmentDisplay url="https://example.com/contract.pdf" name="contract.pdf" kind="file" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'contract.pdf' });
    expect(link).toHaveAttribute('href', 'https://example.com/contract.pdf');
  });

  it('falls back to the last URL segment when name is omitted', () => {
    render(<SingleAttachmentDisplay url="https://example.com/uploads/report.csv" kind="file" />);
    expect(screen.getByRole('link', { name: 'report.csv' })).toBeInTheDocument();
  });

  it('renders a download link for kind=video and kind=audio too', () => {
    render(<SingleAttachmentDisplay url="https://example.com/clip.mp4" name="clip.mp4" kind="video" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'clip.mp4' })).toBeInTheDocument();
  });
});
