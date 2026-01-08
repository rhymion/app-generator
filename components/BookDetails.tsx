import Image from 'next/image';
import type { BookDetailsProps } from '@/lib/types';

export default function BookDetails({ index, book }: BookDetailsProps) {
  return (
    <div className="flex w-full mb-4">
      <div style={{ width: 128, height: 163, position: 'relative' }}>
        <Image src={book.image} alt={book.title} /*width={128} height={163}*/ sizes="100vh"
          fill priority={(index ?? 0) < 5}  />
      </div>
      <div>
        <ul className="list-none text-black ml-4">
          <li>{index && index + '.'}</li>
          <li>{book.title}（{book.price}円）</li>
          <li>{book.author}</li>
          <li>{book.publisher}刊</li>
          <li>{book.published} 発売</li>
        </ul>
      </div>
    </div>
    );
  }