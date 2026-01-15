import BookDetails from '@/components/BookDetails';
import FormEdit from '@/components/FormEdit';
import { getBookById, getReviewById } from '@/lib/getters';
import type { EditPageProps } from '@/lib/types';
// import { Metadata } from 'next';

export default async function EditPage({ params }: EditPageProps) {
  const { id } = await params;
  const review = await getReviewById(id);
  const book = review ? {
    id: review.bookId,
    title: review.title,
    author: review.author,
    price: review.price,
    publisher: review.publisher,
    published: review.published,
    image: review.image,
  } : await getBookById(id);

  const read = (review?.read || new Date()).toLocaleDateString('sv-SE');
  return (
    <div id="form">
      <BookDetails book={book} />
      <hr />
      <FormEdit src={{ id: book.id, read, memo: review?.memo }} />
    </div>
  );
}

// 動的メタデータ
// export async function generateMetadata({ params, searchParams }: EditPageProps): Promise<Metadata> {
//   const { id } = await params;
//   const result = await getBookById(id);
//   const { key } = await searchParams;
//   console.log('クエリ情報', key);

//   return {
//     title: result.title,
//     keywords: [result.author, result.publisher]
//   };
// }