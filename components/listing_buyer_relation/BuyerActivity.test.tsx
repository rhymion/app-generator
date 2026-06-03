import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BuyerActivity from './BuyerActivity';

const src = {
  id: 'relation-1',
  listing_id: 'listing-1',
  buyer_id: 'buyer-1',
  listing: null,
  buyer: null,
  commentable: null,
};

describe('BuyerActivity', () => {
  it('renders buyer activity fields as read-only', () => {
    render(<BuyerActivity src={src} />);

    expect(screen.getByRole('heading', { name: 'Buyer Activity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Opens')).toBeInTheDocument();
    expect(screen.getByLabelText('Time')).toBeInTheDocument();
    expect(screen.getByLabelText('3D')).toBeInTheDocument();
    expect(screen.getByLabelText('Last Seen')).toBeInTheDocument();
    expect(screen.getByLabelText('Intent')).toBeInTheDocument();
  });
});
