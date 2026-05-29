import { getTranslations } from 'next-intl/server';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { Link } from '@/i18n/navigation';

export default async function SettingPage() {
  await getSessionUserIdOrThrow();
  const t = await getTranslations('Setting');

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4, px: 2 }}>
      <Typography variant="h5" fontWeight="bold" mb={3}>
        {t('title')}
      </Typography>
      <Box display="flex" flexDirection="column" gap={2}>
        <Card variant="outlined">
          <CardActionArea component={Link} href="/setting/mfa">
            <CardContent>
              <Typography variant="subtitle1" fontWeight="bold">
                {t('mfaTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('mfaBody')}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card variant="outlined">
          <CardActionArea component={Link} href="/setting/accounts">
            <CardContent>
              <Typography variant="subtitle1" fontWeight="bold">
                {t('accountsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('accountsBody')}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>
    </Box>
  );
}
