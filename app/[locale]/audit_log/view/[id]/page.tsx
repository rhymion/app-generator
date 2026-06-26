import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/audit_log/FormView';
import { getAuditLogDetailPageData } from '@/lib/audit_log/getters';
import { AuditLogDetailPageProps } from '@/lib/audit_log/types';
import { notFound } from 'next/navigation';

export default async function ViewAuditLogPage({ params }: AuditLogDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <AuditLogViewContent id={id} />
    </Suspense>
  );
}

async function AuditLogViewContent({ id }: { id: string }) {
  const { auditLog, userPermissions } = await getAuditLogDetailPageData(id);
  if (!auditLog) {
    notFound();
  }
  return <FormView src={auditLog} permissions={userPermissions} />;
}
