import BookDetails from '@/components/BookDetails';
import FormEdit from '@/components/FormEdit';
import { getBookById, getReviewById } from '@/lib/getters';
import type { EditPageProps } from '@/lib/types';
// import { Metadata } from 'next';

export default async function EditPage({ params }: EditPageProps) {
  const { id } = await params;
  const book = await getBookById(id);
  const review = await getReviewById(id);
  const read = (review?.read || new Date()).toLocaleDateString('sv-SE');
  // const read = (review?.read || new Date()).toLocaleDateString('ja-JP',
  //   { year: 'numeric', month: '2-digit', day: '2-digit' }
  // ).replaceAll('/', '-')
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