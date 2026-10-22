import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ListWrapper from './ListWrapper';

describe('ListWrapper', () => {
  it('renders empty state when there are no items', () => {
    render(<ListWrapper items={[]} itemType="text" />);
    expect(screen.getByText('No items yet')).toBeInTheDocument();
  });

  it('renders a single item', () => {
    render(
      <ListWrapper
        itemType="text"
        items={[{ id: '1', value: 'One', label: 'Item One' }]}
      />
    );

    expect(screen.getByText('Item One')).toBeInTheDocument();
    expect(screen.queryByText('No items yet')).not.toBeInTheDocument();
  });

  it('renders multiple items', () => {
    render(
      <ListWrapper
        itemType="text"
        items={[
          { id: '1', value: 'One', label: 'Item One' },
          { id: '2', value: 'Two', label: 'Item Two' },
          { id: '3', value: 'Three', label: 'Item Three' },
        ]}
      />
    );

    expect(screen.getByText('Item One')).toBeInTheDocument();
    expect(screen.getByText('Item Two')).toBeInTheDocument();
    expect(screen.getByText('Item Three')).toBeInTheDocument();
  });

  it('links a row that carries an href to its record, and leaves the others as text', () => {
    render(
      <ListWrapper
        itemType="text"
        items={[
          { id: '1', value: 'One', label: 'Item One', href: '/thing/view/1' },
          { id: '2', value: 'Two', label: 'Item Two' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'Item One' })).toHaveAttribute('href', '/thing/view/1');
    expect(screen.queryByRole('link', { name: 'Item Two' })).not.toBeInTheDocument();
    expect(screen.getByText('Item Two')).toBeInTheDocument();
  });
});
