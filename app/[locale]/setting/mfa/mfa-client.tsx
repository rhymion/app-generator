'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { EnrollmentStatus } from '@/lib/mfa/enrollment';
import type { MfaErrorCode } from './actions';
import {
  cancelEnrollmentAction,
  completeEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
  startEnrollmentAction,
} from './actions';
import AppAlert from '@/components/ui/AppAlert';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppDivider from '@/components/ui/AppDivider';
import AppSurface from '@/components/ui/AppSurface';
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

// Three persistent states (mirroring the server-fetched EnrollmentStatus)
// plus a transient one — `recovery-display` — that only the client sees
// because the plaintext codes are returned from the action but never
// committed to any client-readable storage. Once the user clicks "I've
// saved them", we router.refresh() and the page re-renders as `enabled`.
// `regenerated` distinguishes a post-regeneration display from the initial
// enrollment display so the correct success message is shown.
type LocalState =
  | { kind: 'disabled' }
  | { kind: 'pending'; qrDataUrl: string; secret: string }
  | { kind: 'recovery-display'; codes: string[]; regenerated?: boolean }
  | { kind: 'enabled' };

function statusToLocal(s: EnrollmentStatus): LocalState {
  if (s.state === 'pending') {
    return { kind: 'pending', qrDataUrl: s.qrDataUrl, secret: s.secret };
  }
  if (s.state === 'enabled') return { kind: 'enabled' };
  return { kind: 'disabled' };
}

export default function MfaClient({ initial }: { initial: EnrollmentStatus }) {
  const t = useTranslations('Mfa');
  const router = useRouter();
  const [state, setState] = useState<LocalState>(() => statusToLocal(initial));
  const [error, setError] = useState<MfaErrorCode | null>(null);
  const [code, setCode] = useState('');
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState('');
  const [pending, startTransition] = useTransition();

  async function onEnable() {
    setError(null);
    startTransition(async () => {
      const res = await startEnrollmentAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Use the QR data returned directly to avoid the useState-doesn't-reinitialize
      // race where router.refresh() updates `initial` prop but the component
      // state never re-syncs because useState runs its initializer only once.
      if ('qrDataUrl' in res && res.qrDataUrl) {
        setState({ kind: 'pending', qrDataUrl: res.qrDataUrl, secret: res.secret });
        return;
      }
      router.refresh();
    });
  }

  async function onVerify() {
    setError(null);
    const res = await completeEnrollmentAction(code);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // The plaintext recovery codes are short-lived in component state.
    // They never hit localStorage or the URL.
    const codes = 'recoveryCodes' in res ? res.recoveryCodes : [];
    setCode('');
    setState({ kind: 'recovery-display', codes });
  }

  async function onDisable() {
    setError(null);
    const res = await disableMfaAction(code);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCode('');
    setState({ kind: 'disabled' });
    router.refresh();
  }

  async function onCancelPending() {
    setError(null);
    startTransition(async () => {
      await cancelEnrollmentAction();
      router.refresh();
    });
  }

  async function onRegenerateCodes() {
    setError(null);
    startTransition(async () => {
      const res = await regenerateRecoveryCodesAction(regenerateCode);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRegenerateCode('');
      setRegenerateOpen(false);
      setState({ kind: 'recovery-display', codes: res.recoveryCodes, regenerated: true });
    });
  }

  function onAcknowledgeRecoveryCodes() {
    setState({ kind: 'enabled' });
    router.refresh();
  }

  return (
    <AppBox maxWidth={560} mx="auto" p={3}>
      <AppText variant="h5" fontWeight="bold" mb={2}>
        {t('title')}
      </AppText>

      {error && <AppAlert severity="error" mb={2}>{t(MFA_ERROR_KEYS[error] ?? 'errorUnknown')}</AppAlert>}

      {state.kind === 'disabled' && (
        <AppSurface variant="outlined" p={3}>
          <AppText variant="body1" mb={2}>{t('disabledIntro')}</AppText>
          <AppButton variant="contained" onClick={onEnable} disabled={pending}>
            {t('enableButton')}
          </AppButton>
        </AppSurface>
      )}

      {state.kind === 'pending' && (
        <AppSurface variant="outlined" p={3}>
          <AppText variant="body1" mb={2}>{t('pendingIntro')}</AppText>
          <AppBox textAlign="center" mb={2}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qrDataUrl} alt={t('qrAlt')} width={240} height={240} />
          </AppBox>
          <AppText variant="body2" mb={1}>{t('manualEntryLabel')}</AppText>
          <AppText
            variant="body2"
            fontFamily="monospace"
            p={1}
            bgcolor="grey.100"
            borderRadius={1}
            mb={3}
            wordBreak="break-all"
          >
            {state.secret}
          </AppText>
          <AppFieldInput
            label={t('verifyCodeLabel')}
            value={code}
            onChange={(val) => setCode(val)}
            fullWidth
            autoComplete="one-time-code"
            inputMode="numeric"
            mb={2}
          />
          <AppStack direction="row" spacing={1}>
            <AppButton
              variant="contained"
              onClick={onVerify}
              disabled={pending || code.length === 0}
            >
              {t('verifyButton')}
            </AppButton>
            <AppButton variant="outlined" onClick={onCancelPending} disabled={pending}>
              {t('cancelButton')}
            </AppButton>
          </AppStack>
        </AppSurface>
      )}

      {state.kind === 'recovery-display' && (
        <AppSurface variant="outlined" p={3}>
          <AppAlert severity="warning" mb={2}>
            {state.regenerated ? t('regenerateSuccess') : t('recoveryWarning')}
          </AppAlert>
          <AppBox display="grid" gridTemplateColumns="1fr 1fr" gap={1} fontFamily="monospace" mb={3}>
            {state.codes.map((c) => (
              <AppBox key={c} p={1} bgcolor="grey.100" borderRadius={1} textAlign="center">{c}</AppBox>
            ))}
          </AppBox>
          <AppButton variant="contained" onClick={onAcknowledgeRecoveryCodes}>
            {t('recoveryAck')}
          </AppButton>
        </AppSurface>
      )}

      {state.kind === 'enabled' && (
        <AppSurface variant="outlined" p={3}>
          <AppAlert severity="success" mb={2}>{t('enabledStatus')}</AppAlert>
          <AppText variant="body1" mb={2}>{t('disableIntro')}</AppText>
          <AppFieldInput
            label={t('disableCodeLabel')}
            value={code}
            onChange={(val) => setCode(val)}
            fullWidth
            autoComplete="one-time-code"
            inputMode="numeric"
            mb={2}
          />
          <AppButton
            variant="contained"
            color="error"
            onClick={onDisable}
            disabled={pending || code.length === 0}
          >
            {t('disableButton')}
          </AppButton>

          <AppDivider my={3} />

          <AppText variant="body1" mb={2}>{t('regenerateIntro')}</AppText>
          {!regenerateOpen ? (
            <AppButton variant="outlined" onClick={() => setRegenerateOpen(true)} disabled={pending}>
              {t('regenerateButton')}
            </AppButton>
          ) : (
            <AppStack spacing={2}>
              <AppFieldInput
                label={t('disableCodeLabel')}
                value={regenerateCode}
                onChange={(val) => setRegenerateCode(val)}
                fullWidth
                autoComplete="one-time-code"
                inputMode="numeric"
              />
              <AppStack direction="row" spacing={1}>
                <AppButton
                  variant="contained"
                  onClick={onRegenerateCodes}
                  disabled={pending || regenerateCode.length === 0}
                >
                  {t('regenerateButton')}
                </AppButton>
                <AppButton
                  variant="outlined"
                  onClick={() => { setRegenerateOpen(false); setRegenerateCode(''); setError(null); }}
                  disabled={pending}
                >
                  {t('cancelButton')}
                </AppButton>
              </AppStack>
            </AppStack>
          )}
        </AppSurface>
      )}
    </AppBox>
  );
}
