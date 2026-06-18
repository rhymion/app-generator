import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/tip_tx/FormView';
import { getTipTxDetailPageData } from '@/lib/tip_tx/getters';
import { TipTxDetailPageProps } from '@/lib/tip_tx/types';
import { notFound } from 'next/navigation';

export default async function ViewTipTxPage({ params }: TipTxDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TipTxViewContent id={id} />
    </Suspense>
  );
}

async function TipTxViewContent({ id }: { id: string }) {
  const { tipTx, userPermissions } = await getTipTxDetailPageData(id);
  if (!tipTx) {
    notFound();
  }
  return <FormView src={tipTx} permissions={userPermissions} />;
}
