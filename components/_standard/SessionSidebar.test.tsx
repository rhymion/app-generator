import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mocks must be declared before the import under test
const mockClose = vi.fn();
let mockIsOpen = false;

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn().mockReturnValue('/home'),
}));

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({ isOpen: mockIsOpen, close: mockClose }),
}));

vi.mock('../../app/[locale]/@sidebar/page', () => ({
  default: () => <nav data-testid="sidebar-nav">Sidebar</nav>,
}));

vi.mock('@/lib/site-config', () => ({
  themeConfig: {
    sidebar: {
      panel: 'bg-white',
      backdrop: 'bg-black/50',
    },
  },
}));

import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import SessionSidebar from './SessionSidebar';

const mockUseSession = vi.mocked(useSession);
const mockUsePathname = vi.mocked(usePathname);

describe('SessionSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOpen = false;
    mockUsePathname.mockReturnValue('/home');
  });

  it('renders nothing when session is absent', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() });
    const { container } = render(<SessionSidebar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders desktop sidebar when session is present', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Alice' }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });
    render(<SessionSidebar />);
    expect(screen.getAllByTestId('sidebar-nav').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render mobile drawer when isOpen=false', () => {
    mockIsOpen = false;
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Alice' }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });
    render(<SessionSidebar />);
    // Mobile drawer uses fixed inset-0 — there should be exactly 1 sidebar (desktop only)
    expect(screen.getAllByTestId('sidebar-nav')).toHaveLength(1);
  });

  it('renders mobile drawer when isOpen=true', () => {
    mockIsOpen = true;
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Alice' }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });
    render(<SessionSidebar />);
    // Desktop + mobile drawer both render Sidebar
    expect(screen.getAllByTestId('sidebar-nav')).toHaveLength(2);
  });

  it('calls close() on pathname change', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Alice' }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });
    const { rerender } = render(<SessionSidebar />);
    mockUsePathname.mockReturnValue('/tasks');
    rerender(<SessionSidebar />);
    expect(mockClose).toHaveBeenCalled();
  });
});
