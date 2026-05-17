import Link from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations } from 'next-intl/server';

import { getSessionUserIdOrThrow } from '@/lib/authz';

// Settings landing page. Each section is a self-contained sub-route
// (mfa, accounts, …); this page is just the discoverable index that
// makes them reachable from the sidebar / nav.
export default async function SettingsIndexPage() {
  await getSessionUserIdOrThrow();
  const t = await getTranslations('Setting');

  const sections = [
    { href: 'setting/mfa',      title: t('mfaTitle'),      body: t('mfaBody') },
    { href: 'setting/accounts', title: t('accountsTitle'), body: t('accountsBody') },
  ];

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 3 }}>
      <Typography variant="h5" fontWeight="bold" mb={3}>
        {t('title')}
      </Typography>
      <Stack spacing={2}>
        {sections.map((s) => (
          <Card key={s.href} variant="outlined">
            <CardActionArea component={Link} href={`/${s.href}`}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight="bold">
                  {s.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {s.body}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
