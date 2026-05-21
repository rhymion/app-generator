'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslations } from 'next-intl';

import {
  connectProviderAction,
  detachAccountAction,
} from './actions';

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
    <Box sx={{ maxWidth: 640, mx: 'auto', p: 3 }}>
      <Typography variant="h5" fontWeight="bold" mb={2}>
        {t('title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {t('intro')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ mb: 3 }}>
        {accounts.length === 0 ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {t('emptyState')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {accounts.map((a) => {
              const detachLabel = a.canDetach ? t('detach') : t('cannotDetach');
              return (
                <ListItem
                  key={a.id}
                  divider
                  secondaryAction={
                    <Tooltip title={detachLabel}>
                      <span>
                        <IconButton
                          edge="end"
                          aria-label={t('detachAria', { provider: a.provider })}
                          onClick={() => onDetach(a.id)}
                          disabled={!a.canDetach || pending}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  }
                >
                  <ListItemText
                    primary={a.provider}
                    secondary={a.providerAccountId}
                    primaryTypographyProps={{ textTransform: 'capitalize' }}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>

      {!hasPassword && accounts.length === 1 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('passwordlessNotice')}
        </Alert>
      )}

      {availableProviders.length > 0 && (
        <>
          <Typography variant="subtitle1" fontWeight="bold" mb={1}>
            {t('connectMore')}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {availableProviders.map((p) => (
              <form
                key={p}
                action={async () => {
                  await connectProviderAction(p);
                }}
              >
                <Button type="submit" variant="outlined" disabled={pending}>
                  {t('connectButton', { provider: p })}
                </Button>
              </form>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
