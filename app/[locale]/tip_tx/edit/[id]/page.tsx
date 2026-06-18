import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/tip_tx/FormUpsert';
import { getTipTxDetailPageData } from '@/lib/tip_tx/getters';
import { searchCommentOptions } from '@/lib/comment/getters';
import { TipTxDetailPageProps } from '@/lib/tip_tx/types';
import { notFound } from 'next/navigation';

export default async function EditTipTxPage({ params }: TipTxDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TipTxEditContent id={id} />
    </Suspense>
  );
}

async function TipTxEditContent({ id }: { id: string }) {
  const [detail, initialComments] = await Promise.all([
    getTipTxDetailPageData(id, 'update'),
    searchCommentOptions('', [], 50),
  ]);
  if (!detail.tipTx) {
    notFound();
  }
  return <FormUpsert src={detail.tipTx} isEdit={true} permissions={detail.userPermissions} initialComments={ initialComments } searchCommentOptions={ searchCommentOptions } />;
}
