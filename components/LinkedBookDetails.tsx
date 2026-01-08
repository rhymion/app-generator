import Link from 'next/link';
import BookDetails from './BookDetails';
import type { BookDetailsProps } from '@/lib/types';

export default function LinkedBookDetails({ index, book }: BookDetailsProps) {
  return (
  <Link href={`/edit/${book.id}`}>
    <div className="hover:bg-green-50">
      <BookDetails index={index} book={book} />
    </div>
  </Link>
  );
}