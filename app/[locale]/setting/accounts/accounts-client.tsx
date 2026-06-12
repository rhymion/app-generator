'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  connectProviderAction,
  detachAccountAction,
} from './actions';
import AppAlert from '@/components/ui/AppAlert';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppSurface from '@/components/ui/AppSurface';
import AppStack from '@/components/ui/AppStack';
import AppText from '@/components/ui/AppText';
import AppTooltip from '@/components/ui/AppTooltip';
import AppIconButton from '@/components/ui/AppIconButton';
import { AppList, AppListItem } from '@/components/ui/AppList';

type DetachErrorCode = 'unknown' | 'not_found' | 'last_sign_in_method';

type AccountRow = {
  id: string;
  provider: string;
  providerAccountId: string;
  canDetach: boolean;
};

type Props = {
  accounts: AccountRow[];
  availableProviders: string[];
  hasPassword: boolean;
};

// Map server-side error codes to translation keys. Unknown codes fall
// back to a generic message rather than rendering the raw string.
function errorKey(code: DetachErrorCode): string {
  switch (code) {
    case 'last_sign_in_method': return 'errorLastSignInMethod';
    case 'not_found':           return 'errorNotFound';
    default:                    return 'errorUnknown';
  }
}

export default function AccountsClient({ accounts, availableProviders, hasPassword }: Props) {
  const t = useTranslations('LinkedAccounts');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onDetach(accountId: string) {
    setError(null);
    startTransition(async () => {
      const res = await detachAccountAction(accountId);
      if (!res.ok) {
        setError(t(errorKey(res.error)));
        return;
      }
      router.refresh();
    });
  }

  return (
    <AppBox maxWidth={640} mx="auto" p={3}>
      <AppText variant="h5" fontWeight="bold" mb={2}>
        {t('title')}
      </AppText>
      <AppText variant="body2" color="text.secondary" mb={3}>
        {t('intro')}
      </AppText>

      {error && <AppAlert severity="error" mb={2}>{error}</AppAlert>}

      <AppSurface variant="outlined" mb={3}>
        {accounts.length === 0 ? (
          <AppBox p={3}>
            <AppText variant="body2" color="text.secondary">
              {t('emptyState')}
            </AppText>
          </AppBox>
        ) : (
          <AppList disablePadding>
            {accounts.map((a) => {
              const detachLabel = a.canDetach ? t('detach') : t('cannotDetach');
              return (
                <AppListItem
                  key={a.id}
                  divider
                  primary={a.provider}
                  secondary={a.providerAccountId}
                  primaryTextTransform="capitalize"
                  secondaryAction={
                    <AppTooltip title={detachLabel}>
                      <span>
                        <AppIconButton
                          iconName="DeleteOutline"
                          edge="end"
                          label={t('detachAria', { provider: a.provider })}
                          onClick={() => onDetach(a.id)}
                          disabled={!a.canDetach || pending}
                        />
                      </span>
                    </AppTooltip>
                  }
                />
              );
            })}
          </AppList>
        )}
      </AppSurface>

      {!hasPassword && accounts.length === 1 && (
        <AppAlert severity="info" mb={3}>
          {t('passwordlessNotice')}
        </AppAlert>
      )}

      {availableProviders.length > 0 && (
        <>
          <AppText variant="subtitle1" fontWeight="bold" mb={1}>
            {t('connectMore')}
          </AppText>
          <AppStack direction="row" spacing={1} flexWrap="wrap">
            {availableProviders.map((p) => (
              <form
                key={p}
                action={async () => {
                  await connectProviderAction(p);
                }}
              >
                <AppButton type="submit" variant="outlined" disabled={pending}>
                  {t('connectButton', { provider: p })}
                </AppButton>
              </form>
            ))}
          </AppStack>
        </>
      )}
    </AppBox>
  );
}
