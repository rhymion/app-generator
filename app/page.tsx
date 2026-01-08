import { getAllReviews } from '@/lib/getters';
import LinkedBookDetails from '@/components/LinkedBookDetails';
// import {
//   unstable_cacheTag as cacheTag,
//   unstable_cacheLife as cacheLife } from 'next/cache';

export default async function Home() {
  'use cache';
  // cacheTag('reviews');
  // cacheLife('hours');
  const reviews = await getAllReviews();
  console.log(reviews);
  return reviews.map((b, i) => (
    <LinkedBookDetails book={b} index={i + 1} key={b.id} />
  ));
}