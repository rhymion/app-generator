'use client';

import { useState } from 'react';
import { verifyAndHashPassword } from '@/lib/setting/password-actions';
import AppButton from '@/components/ui/AppButton';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppSection from '@/components/ui/layout/AppSection';

export default function Password({ onChange }: { value?: string; onChange?: (val: string) => void; isEdit?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleChange = async () => {
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setError(null);
    setSuccess(false);
    setIsPending(true);
    try {
      const hash = await verifyAndHashPassword(current, next);
      onChange?.(hash);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify password');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AppSection label="Change Password" mt={2}>
      <AppFieldInput
        label="Current Password"
        type="password"
        value={current}
        onChange={(val) => setCurrent(val)}
        fullWidth
        margin="normal"
      />
      <AppFieldInput
        label="New Password"
        type="password"
        value={next}
        onChange={(val) => setNext(val)}
        fullWidth
        margin="normal"
      />
      <AppFieldInput
        label="Confirm New Password"
        type="password"
        value={confirm}
        onChange={(val) => setConfirm(val)}
        fullWidth
        margin="normal"
      />
      {error && <AppText color="error" variant="body2">{error}</AppText>}
      {success && <AppText color="success.main" variant="body2">Password verified — click Save to apply</AppText>}
      <AppButton
        variant="contained"
        onClick={handleChange}
        disabled={isPending || !current || !next || !confirm}
        mt={1}
      >
        Verify Password
      </AppButton>
    </AppSection>
  );
}
