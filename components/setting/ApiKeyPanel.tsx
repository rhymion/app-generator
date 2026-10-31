'use client';

import { useEffect, useState, type FC } from 'react';
import { useTranslations } from 'next-intl';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppFieldBoolean from '@/components/ui/forms/AppFieldBoolean';
import AppInputAction from '@/components/ui/AppInputAction';
import AppSection from '@/components/ui/layout/AppSection';
import { getApiKeyStatus, issueApiKey, setApiKeyExpiry, type ApiKeyStatus } from '@/lib/setting/api-key-actions';

// The settings view passes its record and permissions to every entity-level component;
// this panel reads its own state through the Server Actions and needs none of them.
interface ApiKeyPanelProps {
  src?: unknown;
  permissions?: unknown;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// `YYYY-MM-DDTHH:mm` in the browser's time zone, the value format of a datetime-local input.
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The chosen expiry as an ISO string, or null when it is not a future date-time.
function futureIso(local: string): string | null {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date.toISOString();
}

/**
 * API key section of the account settings page. It shows whether a key is set
 * and when it was issued, and issues a replacement. A new key is shown once, in
 * the response to the issue request; leaving the page discards it.
 */
const ApiKeyPanel: FC<ApiKeyPanelProps> = () => {
  const t = useTranslations('ApiKey');
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Expiry chosen for the next key; starts at the site default once the status is loaded.
  const [issueNever, setIssueNever] = useState(false);
  const [issueExpiry, setIssueExpiry] = useState('');
  // Expiry of the current key; starts at its present value.
  const [changeNever, setChangeNever] = useState(false);
  const [changeExpiry, setChangeExpiry] = useState('');

  const applyCurrent = (s: ApiKeyStatus) => {
    setChangeNever(s.expiresAt === null);
    setChangeExpiry(toLocalInput(s.expiresAt ? new Date(s.expiresAt) : new Date(Date.now() + DAY_MS)));
  };

  useEffect(() => {
    getApiKeyStatus()
      .then((s) => {
        setStatus(s);
        setIssueNever(s.defaultExpiryDays === null);
        setIssueExpiry(toLocalInput(new Date(Date.now() + (s.defaultExpiryDays ?? 90) * DAY_MS)));
        applyCurrent(s);
      })
      .catch(() => setError(t('loadFailed')));
  }, [t]);

  const issue = async () => {
    setError(null);
    const expiresAt = issueNever ? null : futureIso(issueExpiry);
    if (!issueNever && expiresAt === null) {
      setError(t('expiryInvalid'));
      return;
    }
    setIsPending(true);
    try {
      const result = await issueApiKey({ expiresAt });
      setNewKey(result.apiKey);
      setStatus(result.status);
      applyCurrent(result.status);
    } catch {
      setError(t('issueFailed'));
    } finally {
      setIsPending(false);
    }
  };

  const saveExpiry = async () => {
    setError(null);
    const expiresAt = changeNever ? null : futureIso(changeExpiry);
    if (!changeNever && expiresAt === null) {
      setError(t('expiryInvalid'));
      return;
    }
    setIsPending(true);
    try {
      const next = await setApiKeyExpiry(expiresAt);
      setStatus(next);
      applyCurrent(next);
    } catch {
      setError(t('expiryFailed'));
    } finally {
      setIsPending(false);
    }
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleString();

  return (
    <AppSection label={t('title')} mt={2}>
      {status && (
        <AppText>
          {status.isSet
            ? status.issuedAt
              ? t('statusSetIssued', { issuedAt: formatDate(status.issuedAt) })
              : t('statusSet')
            : t('statusNotSet')}
          {status.isSet
            ? ` ${
                status.expiresAt === null
                  ? t('neverExpires')
                  : status.expired
                    ? t('expired', { expiresAt: formatDate(status.expiresAt) })
                    : t('expires', { expiresAt: formatDate(status.expiresAt) })
              }`
            : ''}
        </AppText>
      )}
      {newKey && (
        <AppBox display="flex" alignItems="center" gap={1} mt={2} mb={1}>
          <AppFieldInput
            label={t('newKeyLabel')}
            value={newKey}
            fullWidth
            readOnly
            endAction={
              <AppInputAction
                position="end"
                iconName="ContentCopy"
                iconFontSize="small"
                size="small"
                title={t('copy')}
                onClick={() => navigator.clipboard.writeText(newKey)}
              />
            }
          />
        </AppBox>
      )}
      {newKey && <AppText>{t('shownOnce')}</AppText>}
      {error && <AppText color="error">{error}</AppText>}
      <AppBox display="flex" alignItems="center" gap={2} mt={2} mb={1}>
        {!issueNever && (
          <AppFieldInput
            label={t('newKeyExpiryLabel')}
            type="datetime-local"
            value={issueExpiry}
            onChange={setIssueExpiry}
            testId="api-key-issue-expiry"
          />
        )}
        <AppFieldBoolean label={t('neverExpiresOption')} checked={issueNever} onChange={(e) => setIssueNever(e.target.checked)} />
      </AppBox>
      <AppButton variant="outlined" onClick={issue} disabled={isPending} className="whitespace-nowrap">
        {status?.isSet ? t('reissue') : t('issue')}
      </AppButton>
      {status?.isSet && <AppText>{t('reissueWarning')}</AppText>}
      {status?.isSet && (
        <AppBox display="flex" alignItems="center" gap={2} mt={3} mb={1}>
          {!changeNever && (
            <AppFieldInput
              label={t('currentKeyExpiryLabel')}
              type="datetime-local"
              value={changeExpiry}
              onChange={setChangeExpiry}
              testId="api-key-change-expiry"
            />
          )}
          <AppFieldBoolean label={t('neverExpiresOption')} checked={changeNever} onChange={(e) => setChangeNever(e.target.checked)} />
          <AppButton variant="outlined" onClick={saveExpiry} disabled={isPending} className="whitespace-nowrap">
            {t('saveExpiry')}
          </AppButton>
        </AppBox>
      )}
    </AppSection>
  );
};

export default ApiKeyPanel;
