import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/tip_tx/FormUpsert';
import { searchCommentOptions } from '@/lib/comment/getters';
import { getTipTxNewPageAccessCheck } from '@/lib/tip_tx/getters';

export default function AddTipTxPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TipTxNewContent />
    </Suspense>
  );
}

async function TipTxNewContent() {
  const [userPermissions, initialComments] = await Promise.all([
    getTipTxNewPageAccessCheck(),
    searchCommentOptions('', [], 50),
  ]);
  const src = {
    id: '',
    gross_amount: null,
    operator_fee: null,
    payment_fee: null,
    contract_split_id: '',
    status: null,
    comment_id: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialComments={ initialComments } searchCommentOptions={ searchCommentOptions } />;
}
