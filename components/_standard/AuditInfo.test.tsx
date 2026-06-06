import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuditInfo from './AuditInfo';

describe('AuditInfo', () => {
  it('renders nothing when neither created_at nor updated_at is present', () => {
    const { container } = render(<AuditInfo src={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders created date when only created_at provided', () => {
    render(<AuditInfo src={{ created_at: '2024-01-15T10:30:00Z' }} />);
    expect(screen.getByText(/Created:/)).toBeInTheDocument();
  });

  it('renders updated date when only updated_at provided', () => {
    render(<AuditInfo src={{ updated_at: '2024-06-01T08:00:00Z' }} />);
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('renders both created and updated dates', () => {
    render(
      <AuditInfo
        src={{
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
        }}
      />
    );
    expect(screen.getByText(/Created:/)).toBeInTheDocument();
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('shows separator " | " when both dates are present', () => {
    render(
      <AuditInfo
        src={{
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
        }}
      />
    );
    expect(screen.getByText(/\|/)).toBeInTheDocument();
  });

  it('shows creator name when provided', () => {
    render(
      <AuditInfo
        src={{
          created_at: '2024-01-01T00:00:00Z',
          creator: { id: 'u1', name: 'Alice' },
        }}
      />
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('shows updater name when provided', () => {
    render(
      <AuditInfo
        src={{
          updated_at: '2024-01-01T00:00:00Z',
          updater: { id: 'u2', name: 'Bob' },
        }}
      />
    );
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('formats date using formatDate (sv-SE locale)', () => {
    render(<AuditInfo src={{ created_at: '2024-06-15T00:00:00Z' }} />);
    // sv-SE uses YYYY-MM-DD HH:MM:SS format — year "2024" must be present
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });
});
