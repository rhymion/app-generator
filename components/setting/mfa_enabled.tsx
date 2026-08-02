'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { MfaErrorCode } from '@/app/[locale]/setting/mfa/actions';
import { disableMfaAction } from '@/app/[locale]/setting/mfa/actions';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppChip from '@/components/ui/AppChip';
import AppStack from '@/components/ui/AppStack';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppText from '@/components/ui/AppText';

const MFA_ERROR_KEYS: Record<MfaErrorCode, string> = {
  INVALID_CODE: 'errorInvalidCode',
  MFA_NOT_ENABLED: 'errorNotEnabled',
  MFA_ALREADY_ENABLED: 'errorAlreadyEnabled',
  SESSION_REQUIRED: 'errorSessionRequired',
  UNKNOWN_ERROR: 'errorUnknown',
};

export default function MfaEnabled({value, onChange: _onChange, isEdit: _isEdit}: {value: boolean, onChange: (val: boolean) => void, isEdit: boolean}) {
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
      <AppBox mt={2}>
        <AppButton
          component={Link as React.ElementType}
          href="/setting/mfa"
          variant="outlined"
        >
          {t('toggleEnableButton')}
        </AppButton>
      </AppBox>
    );
  }

  return (
    <AppBox mt={2}>
      <AppStack direction="row" alignItems="center" spacing={2} mb={1}>
        <AppChip label={t('toggleEnabledLabel')} color="success" size="small" />
        {!showDisableForm && (
          <AppButton
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => setShowDisableForm(true)}
            disabled={isPending}
          >
            {t('toggleDisableButton')}
          </AppButton>
        )}
      </AppStack>
      {showDisableForm && (
        <AppStack spacing={1} mt={1} maxWidth={320}>
          <AppFieldInput
            label={t('disableCodeLabel')}
            value={code}
            onChange={(val) => setCode(val)}
            size="small"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={12}
          />
          {error && (
            <AppText variant="caption" color="error">
              {t(MFA_ERROR_KEYS[error] as Parameters<typeof t>[0])}
            </AppText>
          )}
          <AppStack direction="row" spacing={1}>
            <AppButton
              variant="contained"
              color="warning"
              size="small"
              onClick={handleDisable}
              disabled={isPending || code.length === 0}
            >
              {t('toggleDisableButton')}
            </AppButton>
            <AppButton
              variant="outlined"
              size="small"
              onClick={() => { setShowDisableForm(false); setCode(''); setError(null); }}
              disabled={isPending}
            >
              {t('cancelButton')}
            </AppButton>
          </AppStack>
        </AppStack>
      )}
    </AppBox>
  );
}
