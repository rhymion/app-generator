'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { MfaErrorCode } from '@/app/[locale]/setting/mfa/actions';
import { disableMfaAction } from '@/app/[locale]/setting/mfa/actions';

const MFA_ERROR_KEYS: Record<MfaErrorCode, string> = {
  INVALID_CODE: 'errorInvalidCode',
  MFA_NOT_ENABLED: 'errorNotEnabled',
  MFA_ALREADY_ENABLED: 'errorAlreadyEnabled',
  SESSION_REQUIRED: 'errorSessionRequired',
  UNKNOWN_ERROR: 'errorUnknown',
};

export default function MfaEnabled({value, onChange, isEdit}: {value: boolean, onChange: (val: boolean) => void, isEdit: boolean}) {
  const t = useTranslations('Mfa');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<MfaErrorCode | null>(null);

  const mfaEnabled = value;

  function handleDisable() {
    setError(null);
    startTransition(async () => {
      const res = await disableMfaAction(code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCode('');
      setShowDisableForm(false);
      router.refresh();
    });
  }

  if (!mfaEnabled) {
    return (
      <Box mt={2}>
        <Button
          component={Link}
          href="/setting/mfa"
          variant="outlined"
        >
          {t('toggleEnableButton')}
        </Button>
      </Box>
    );
  }

  return (
    <Box mt={2}>
      <Stack direction="row" alignItems="center" spacing={2} mb={1}>
        <Chip label={t('toggleEnabledLabel')} color="success" size="small" />
        {!showDisableForm && (
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => setShowDisableForm(true)}
            disabled={isPending}
          >
            {t('toggleDisableButton')}
          </Button>
        )}
      </Stack>
      {showDisableForm && (
        <Stack spacing={1} mt={1} maxWidth={320}>
          <TextField
            label={t('disableCodeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            autoComplete="one-time-code"
            inputProps={{ maxLength: 12 }}
          />
          {error && (
            <Typography variant="caption" color="error">
              {t(MFA_ERROR_KEYS[error] as Parameters<typeof t>[0])}
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="warning"
              size="small"
              onClick={handleDisable}
              disabled={isPending || code.length === 0}
            >
              {t('toggleDisableButton')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => { setShowDisableForm(false); setCode(''); setError(null); }}
              disabled={isPending}
            >
              {t('cancelButton')}
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
