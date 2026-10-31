'use client';

import { useEffect, useState, type FC } from 'react';
import { useTranslations } from 'next-intl';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppInputAction from '@/components/ui/AppInputAction';
import AppSection from '@/components/ui/layout/AppSection';
import { getApiKeyStatus, issueApiKey, type ApiKeyStatus } from '@/lib/setting/api-key-actions';

// The settings view passes its record and permissions to every entity-level component;
// this panel reads its own state through the Server Actions and needs none of them.
interface ApiKeyPanelProps {
  src?: unknown;
  permissions?: unknown;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
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

  useEffect(() => {
    getApiKeyStatus().then(setStatus).catch(() => setError(t('loadFailed')));
  }, [t]);

  const issue = async () => {
    setError(null);
    setIsPending(true);
    try {
      const result = await issueApiKey();
      setNewKey(result.apiKey);
      setStatus(result.status);
    } catch {
      setError(t('issueFailed'));
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
          {status.isSet && status.expiresAt ? ` ${t('expires', { expiresAt: formatDate(status.expiresAt) })}` : ''}
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
      <AppButton variant="outlined" onClick={issue} disabled={isPending} className="whitespace-nowrap">
        {status?.isSet ? t('reissue') : t('issue')}
      </AppButton>
      {status?.isSet && <AppText>{t('reissueWarning')}</AppText>}
    </AppSection>
  );
};

export default ApiKeyPanel;
