import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Button from '@mui/material/Button';
import { getSessionUserIdOrThrow } from '@/lib/authz';
import { randomBytes } from 'crypto';
//import { revalidatePath } from 'next/cache';

export async function generateApiKey(): Promise<string> {
  await getSessionUserIdOrThrow();
  const apiKey = `mk_${randomBytes(32).toString('hex')}`;
  //await prisma.user_account.update({ where: { id: userId }, data: { api_key: apiKey } });
  //revalidatePath('/');
  return apiKey;
}

export default function ApiKey({value, onChange, isEdit}: {value: string, onChange: (key: string) => void, isEdit: boolean}) {

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 1 }}>
    <TextField
        label="Api Key"
        value={value}
        fullWidth
        slotProps={{
        input: {
            readOnly: true,
            endAdornment: value ? (
            <InputAdornment position="end">
                <IconButton
                size="small"
                onClick={() => navigator.clipboard.writeText(value)}
                title="Copy to clipboard"
                >
                <ContentCopyIcon fontSize="small" />
                </IconButton>
            </InputAdornment>
            ) : undefined,
        },
        }}
    />
    {isEdit && (
        <Button
        variant="outlined"
        onClick={async () => {
            const key = await generateApiKey();
            onChange(key);
        }}
        sx={{ whiteSpace: 'nowrap' }}
        >
        Generate Key
        </Button>
    )}
    </Box>
  );
}