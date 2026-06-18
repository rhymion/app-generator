import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/fc_link/FormView';
import { getFcLinkDetailPageData } from '@/lib/fc_link/getters';
import { FcLinkDetailPageProps } from '@/lib/fc_link/types';
import { notFound } from 'next/navigation';

export default async function ViewFcLinkPage({ params }: FcLinkDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <FcLinkViewContent id={id} />
    </Suspense>
  );
}

async function FcLinkViewContent({ id }: { id: string }) {
  const { fcLink, userPermissions } = await getFcLinkDetailPageData(id);
  if (!fcLink) {
    notFound();
  }
  return <FormView src={fcLink} permissions={userPermissions} />;
}
