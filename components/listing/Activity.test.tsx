import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Activity from './Activity';

const src = {
  id: 'listing-1',
  name: 'Listing 1',
  address: '123 Main St',
  image: null,
  status: 0,
  price: 100000,
  bed: 3,
  bath: 2,
  area: 1200,
  buyers: [],
};

describe('Activity', () => {
  it('renders activity fields as read-only', () => {
    render(<Activity src={src} />);

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opens')).toBeInTheDocument();
    expect(screen.getByLabelText('Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Intent')).toBeInTheDocument();
  });
});
