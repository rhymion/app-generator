'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppInputAction from '@/components/ui/AppInputAction';
import type { ModelPermissions } from '@/lib/authz';

const API_KEY_ENDPOINT = '/api/user-account/api-key';

interface Props {
  src?: { id?: string };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
}

/**
 * Self-service API key management (cmd_349 GAP-2/DP-4(a)).
 *
 * Deliberately self-contained: it never receives the raw key as a prop (the
 * `setting` entity's `api_key` field was removed from `fields` for exactly
 * this reason — anything left in `fields` gets serialized to the browser as
 * a prop). Instead it talks directly to the session-only
 * `/api/user-account/api-key` endpoint, which returns only a prefix outside
 * of the one-time reveal right after generate/rotate.
 */
export default function ApiKeyManager({ permissions }: Props) {
  const tf = useTranslations('ApiKeyManager');
  const canManage = permissions ? !!permissions.update : true;

  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API_KEY_ENDPOINT);
        if (!res.ok) throw new Error(tf('errorUnknown'));
        const data = (await res.json()) as { hasKey: boolean; prefix: string | null };
        if (!cancelled) {
          setHasKey(data.hasKey);
          setPrefix(data.prefix);
        }
      } catch {
        if (!cancelled) setError(tf('errorUnknown'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tf]);

  const handleGenerate = async () => {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(API_KEY_ENDPOINT, { method: 'POST' });
      if (!res.ok) throw new Error(tf('errorUnknown'));
      const data = (await res.json()) as { key: string };
      setNewKey(data.key);
      setHasKey(true);
      setPrefix(`${data.key.slice(0, 8)}...`);
      setCopied(false);
    } catch {
      setError(tf('errorUnknown'));
    } finally {
      setIsPending(false);
    }
  };

  const handleRevoke = async () => {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(API_KEY_ENDPOINT, { method: 'DELETE' });
      if (!res.ok) throw new Error(tf('errorUnknown'));
      setHasKey(false);
      setPrefix(null);
      setNewKey(null);
      setCopied(false);
    } catch {
      setError(tf('errorUnknown'));
    } finally {
      setIsPending(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <AppBox display="flex" flexDirection="column" gap={1} mt={2} mb={1}>
      <AppText variant="subtitle2">{tf('title')}</AppText>

      {newKey ? (
        <>
          <AppText variant="body2" color="warning.main">{tf('newKeyWarning')}</AppText>
          <AppFieldInput
            label={tf('newKeyLabel')}
            value={newKey}
            fullWidth
            readOnly
            endAction={(
              <AppInputAction
                position="end"
                iconName="ContentCopy"
                iconFontSize="small"
                size="small"
                title={tf('copyButton')}
                onClick={() => {
                  navigator.clipboard.writeText(newKey);
                  setCopied(true);
                }}
              />
            )}
          />
          {copied && <AppText variant="caption" color="success.main">{tf('copiedText')}</AppText>}
        </>
      ) : (
        <AppText variant="body2">
          {hasKey && prefix ? tf('hasKeyText', { prefix }) : tf('noKeyText')}
        </AppText>
      )}

      {error && <AppText variant="body2" color="error">{error}</AppText>}

      {canManage && (
        <AppBox display="flex" gap={1}>
          <AppButton variant="outlined" size="small" disabled={isPending} onClick={handleGenerate}>
            {hasKey ? tf('rotateButton') : tf('generateButton')}
          </AppButton>
          {hasKey && (
            <AppButton variant="outlined" color="error" size="small" disabled={isPending} onClick={handleRevoke}>
              {tf('revokeButton')}
            </AppButton>
          )}
        </AppBox>
      )}
    </AppBox>
  );
}
