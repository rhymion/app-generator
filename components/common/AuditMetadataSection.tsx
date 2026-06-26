'use client';

import { useEffect, useState } from 'react';
import AuditInfo from '@/components/_standard/AuditInfo';

type AuditMetadataSectionProps = {
  src: {
    id: string;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
};

export default function AuditMetadataSection({ src }: AuditMetadataSectionProps) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/entity-audit')
      .then(r => setIsAdmin(r.ok))
      .catch(() => setIsAdmin(false));
  }, []);

  if (!isAdmin) return null;
  return <AuditInfo src={src} />;
}
