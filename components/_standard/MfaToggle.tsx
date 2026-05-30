'use client';

import Chip from '@mui/material/Chip';
import { useTranslations } from 'next-intl';
import type { ModelPermissions } from '@/lib/authz';

interface Props {
  src: { id: string; mfa_enabled?: boolean };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
}

export default function MfaToggle({ src }: Props) {
  const t = useTranslations('Mfa');
  const mfaEnabled = src.mfa_enabled ?? false;
  return (
    <Chip
      label={mfaEnabled ? t('toggleEnabledLabel') : t('toggleDisabledLabel')}
      color={mfaEnabled ? 'success' : 'default'}
      size="small"
    />
  );
}
