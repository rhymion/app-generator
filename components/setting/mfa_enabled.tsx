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

export default function MfaEnabled({value, onChange, isEdit: _isEdit}: {value: boolean, onChange: (val: boolean) => void, isEdit: boolean}) {
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
      // Sync the parent FormUpsert's local `mfaEnabled` state (app-generator#563):
      // this component is a custom_upsert field embedded in the setting edit
      // form, and that form's own `mfaEnabled` useState only gets its initial
      // value from `value` on mount -- it never re-reads `value` afterwards, so
      // without this call the parent still believes MFA is on. Left unfixed, a
      // "Save" click right after this disable writes the parent's stale
      // mfaEnabled=true back over the mfa_secret=null/mfa_enabled=false that
      // disableMfaAction() just committed, locking the user out (mfa_enabled
      // true but no working secret).
      //
      onChange(false);
      // router.refresh() is still needed too, but NOT inside this
      // transition: measured directly, calling it in the same transition as
      // the onChange() above reliably prevented onChange's update from ever
      // reaching the screen (the "MFA Enabled" chip stayed stuck 8+ seconds;
      // a plain hard reload showed the correct, already-persisted state
      // throughout). Deferring it to a macrotask lets onChange's state
      // update commit and paint first. It's still required for a separate
      // reason: FormUpsert's own `srcSnapshot` (the optimistic-concurrency
      // guard passed to the update action) is derived from the `src` prop
      // via useMemo, so it only catches up to this disable once a fresh
      // `src` arrives from the server -- without it, a "Save" right after
      // this disable is correctly rejected as stale ("record has been
      // updated since you opened it") because mfa_enabled changed
      // server-side out from under the page, but the user has no path to
      // resolve that beyond a manual reload.
      setTimeout(() => router.refresh(), 0);
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
