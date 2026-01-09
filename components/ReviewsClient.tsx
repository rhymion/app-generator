"use client";

import React, { useEffect, useState } from 'react';
import LinkedBookDetails from './LinkedBookDetails';
import type { Review } from '@/lib/types';

export default function ReviewsClient() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/reviews')
      .then((res) => {
        if (!res.ok) throw new Error(`status:${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (mounted) setReviews(data);
      })
      .catch((err) => {
        console.error('Failed to fetch /api/reviews:', err);
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <div>Failed to load reviews: {error}</div>;
  if (reviews === null) return <div>Loading reviews...</div>;

  return reviews.map((b, i) => (
    <LinkedBookDetails book={b} index={i + 1} key={b.id} />
  ));
}
