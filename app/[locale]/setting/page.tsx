'use client';

import { useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import { Link } from '@/i18n/navigation';

export default function SettingPage() {
  const t = useTranslations('Setting');

  return (
    <Box sx={{ maxWidth: 600, mt: 2, mb: 3 }}>
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
