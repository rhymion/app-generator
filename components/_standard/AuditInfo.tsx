'use client';

import Typography from '@mui/material/Typography';

type AuditInfoProps = {
  src: {
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
};

export default function AuditInfo({ src }: AuditInfoProps) {
  if (!src.created_at && !src.updated_at) return null;

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 4 }}>
      <Typography variant="body2" color="text.secondary">
        {src.created_at && (
          <>Created: {formatDate(src.created_at)}{src.creator && ` by ${src.creator.name}`}</>
        )}
        {src.created_at && src.updated_at && ' | '}
        {src.updated_at && (
          <>Updated: {formatDate(src.updated_at)}{src.updater && ` by ${src.updater.name}`}</>
        )}
      </Typography>
    </div>
  );
}
