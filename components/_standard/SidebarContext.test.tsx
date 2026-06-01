import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SidebarProvider, useSidebar } from './SidebarContext';

function Consumer() {
  const { isOpen, open, close, toggle } = useSidebar();
  return (
    <div>
      <span data-testid="state">{isOpen ? 'open' : 'closed'}</span>
      <button onClick={open}>Open</button>
      <button onClick={close}>Close</button>
      <button onClick={toggle}>Toggle</button>
    </div>
  );
}

describe('SidebarContext', () => {
  it('starts with isOpen=false', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>
    );
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });

  it('open() sets isOpen to true', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>
    );
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('close() sets isOpen to false after open', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>
    );
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });

  it('toggle() switches from closed to open', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>
    );
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('toggle() switches from open back to closed', () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>
    );
    fireEvent.click(screen.getByText('Toggle'));
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });
});
