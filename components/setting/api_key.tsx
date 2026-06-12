import { getSessionUserIdOrThrow } from '@/lib/authz';
import { randomBytes } from 'crypto';
import { useTranslations } from 'next-intl';
//import { revalidatePath } from 'next/cache';
import AppBox from '@/components/ui/AppBox';
import AppButton from '@/components/ui/AppButton';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppInputAction from '@/components/ui/AppInputAction';

export async function generateApiKey(): Promise<string> {
  await getSessionUserIdOrThrow();
  const apiKey = `mk_${randomBytes(32).toString('hex')}`;
  //await prisma.user.update({ where: { id: userId }, data: { api_key: apiKey } });
  //revalidatePath('/');
  return apiKey;
}

export default function ApiKey({value, onChange, isEdit}: {value: string, onChange: (key: string) => void, isEdit: boolean}) {
  const tf = useTranslations('Fields');
  return (
    <AppBox display="flex" alignItems="center" gap={1} mt={2} mb={1}>
      <AppFieldInput
        label={tf('apiKey')}
        value={value}
        fullWidth
        readOnly
        endAction={value ? (
          <AppInputAction
            position="end"
            iconName="ContentCopy"
            iconFontSize="small"
            size="small"
            title="Copy to clipboard"
            onClick={() => navigator.clipboard.writeText(value)}
          />
        ) : undefined}
      />
      {isEdit && (
        <AppButton
          variant="outlined"
          className="whitespace-nowrap"
          onClick={async () => {
            const key = await generateApiKey();
            onChange(key);
          }}
        >
          Generate Key
        </AppButton>
      )}
    </AppBox>
  );
}
