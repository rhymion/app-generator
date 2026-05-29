'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
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
      router.refresh();
    });
  }

  async function onVerify() {
    setError(null);
    startTransition(async () => {
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
    });
  }

  async function onDisable() {
    setError(null);
    startTransition(async () => {
      const res = await disableMfaAction(code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCode('');
      router.refresh();
    });
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
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 3 }}>
      <Typography variant="h5" fontWeight="bold" mb={2}>
        {t('title')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{t(MFA_ERROR_KEYS[error] ?? 'errorUnknown')}</Alert>}

      {state.kind === 'disabled' && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body1" mb={2}>{t('disabledIntro')}</Typography>
          <Button variant="contained" onClick={onEnable} disabled={pending}>
            {t('enableButton')}
          </Button>
        </Paper>
      )}

      {state.kind === 'pending' && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body1" mb={2}>{t('pendingIntro')}</Typography>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qrDataUrl} alt={t('qrAlt')} width={240} height={240} />
          </Box>
          <Typography variant="body2" mb={1}>{t('manualEntryLabel')}</Typography>
          <Typography
            variant="body2"
            fontFamily="monospace"
            sx={{ p: 1, bgcolor: 'grey.100', borderRadius: 1, mb: 3, wordBreak: 'break-all' }}
          >
            {state.secret}
          </Typography>
          <TextField
            label={t('verifyCodeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            fullWidth
            autoComplete="one-time-code"
            inputMode="numeric"
            sx={{ mb: 2 }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={onVerify}
              disabled={pending || code.length === 0}
            >
              {t('verifyButton')}
            </Button>
            <Button variant="outlined" onClick={onCancelPending} disabled={pending}>
              {t('cancelButton')}
            </Button>
          </Stack>
        </Paper>
      )}

      {state.kind === 'recovery-display' && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {state.regenerated ? t('regenerateSuccess') : t('recoveryWarning')}
          </Alert>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, fontFamily: 'monospace', mb: 3 }}>
            {state.codes.map((c) => (
              <Box key={c} sx={{ p: 1, bgcolor: 'grey.100', borderRadius: 1, textAlign: 'center' }}>{c}</Box>
            ))}
          </Box>
          <Button variant="contained" onClick={onAcknowledgeRecoveryCodes}>
            {t('recoveryAck')}
          </Button>
        </Paper>
      )}

      {state.kind === 'enabled' && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Alert severity="success" sx={{ mb: 2 }}>{t('enabledStatus')}</Alert>
          <Typography variant="body1" mb={2}>{t('disableIntro')}</Typography>
          <TextField
            label={t('disableCodeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            fullWidth
            autoComplete="one-time-code"
            inputMode="numeric"
            sx={{ mb: 2 }}
          />
          <Button
            variant="contained"
            color="error"
            onClick={onDisable}
            disabled={pending || code.length === 0}
          >
            {t('disableButton')}
          </Button>

          <Divider sx={{ my: 3 }} />

          <Typography variant="body1" mb={2}>{t('regenerateIntro')}</Typography>
          {!regenerateOpen ? (
            <Button variant="outlined" onClick={() => setRegenerateOpen(true)} disabled={pending}>
              {t('regenerateButton')}
            </Button>
          ) : (
            <Stack spacing={2}>
              <TextField
                label={t('disableCodeLabel')}
                value={regenerateCode}
                onChange={(e) => setRegenerateCode(e.target.value)}
                fullWidth
                autoComplete="one-time-code"
                inputMode="numeric"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={onRegenerateCodes}
                  disabled={pending || regenerateCode.length === 0}
                >
                  {t('regenerateButton')}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => { setRegenerateOpen(false); setRegenerateCode(''); setError(null); }}
                  disabled={pending}
                >
                  {t('cancelButton')}
                </Button>
              </Stack>
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
