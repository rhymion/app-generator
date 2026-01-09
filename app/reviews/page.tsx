import LinkedBookDetails from '@/components/LinkedBookDetails'
import { getAllReviews } from '@/lib/getters';

export default async function ReviewsPage() {
  const reviews = await getAllReviews();
  return reviews.map((b, i) => (
    <LinkedBookDetails book={b} index={i + 1} key={b.id} />
  ));
}