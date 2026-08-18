import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NavGroupWrapper from './NavGroupWrapper';

const sidebarTheme = {
  panel: 'bg-gray-100',
  link: 'text-gray-600 hover:bg-gray-200 block px-4 py-2 no-underline transition',
  backdrop: 'bg-black/40',
};

function renderGroup(props: Partial<React.ComponentProps<typeof NavGroupWrapper>> = {}) {
  return render(
    <ul>
      <NavGroupWrapper label="Inventory Group" sidebarTheme={sidebarTheme} {...props}>
        <li>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain <a> stand-in for a nav leaf link, this test has no next/link routing context */}
          <a href="/inventory_reservation">Inventory Reservation</a>
        </li>
      </NavGroupWrapper>
    </ul>
  );
}

describe('NavGroupWrapper', () => {
  it('renders the label', () => {
    renderGroup();
    expect(screen.getByText('Inventory Group')).toBeInTheDocument();
  });

  it('renders an icon when provided', () => {
    const { container } = renderGroup({ icon: 'Inventory2' });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders no icon when absent', () => {
    const { container } = renderGroup();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('starts open when defaultOpen=true', () => {
    renderGroup({ defaultOpen: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('starts closed when defaultOpen=false (default)', () => {
    renderGroup();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles on button click', () => {
    renderGroup();
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('aria-expanded reflects open state and aria-controls matches the child <ul> id', () => {
    renderGroup();
    const button = screen.getByRole('button');
    const controlsId = button.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    const controlled = document.getElementById(controlsId as string);
    expect(controlled).not.toBeNull();
    expect(controlled?.tagName).toBe('UL');
  });

  it('renders children collapsed (max-h-0) when closed and expanded (max-h-screen) when open', () => {
    renderGroup();
    const button = screen.getByRole('button');
    const controlsId = button.getAttribute('aria-controls') as string;
    const contentList = document.getElementById(controlsId) as HTMLElement;

    expect(screen.getByText('Inventory Reservation')).toBeInTheDocument();
    expect(contentList.className).toContain('max-h-0');

    fireEvent.click(button);
    expect(contentList.className).toContain('max-h-screen');
    expect(contentList.className).not.toContain('max-h-0');
  });

  it('the group header is a <button>, not an <a>', () => {
    const { container } = renderGroup();
    const outerLi = container.querySelector('ul > li') as HTMLElement;
    const directChildTags = Array.from(outerLi.children).map((el) => el.tagName);
    expect(directChildTags).toEqual(['BUTTON', 'UL']);
  });
});
