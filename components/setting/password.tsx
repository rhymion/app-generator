'use client';

import { useState } from 'react';
import AppText from '@/components/ui/AppText';
import AppFieldInput from '@/components/ui/forms/AppFieldInput';
import AppSection from '@/components/ui/layout/AppSection';

// New password + confirmation only. The current password is asked once, by the
// "Current password" field of the settings form, and the server checks it when the
// form is saved. Whatever is typed here is handed to the form as soon as the two
// entries agree; while they differ the form is given an empty value and the
// mismatch is shown, so a typed password is never dropped without a visible reason.
export default function Password({ onChange }: { value?: string; onChange?: (val: string) => void; isEdit?: boolean }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = (next !== '' || confirm !== '') && next !== confirm;

  const update = (nextValue: string, confirmValue: string) => {
    setNext(nextValue);
    setConfirm(confirmValue);
    onChange?.(nextValue !== '' && nextValue === confirmValue ? nextValue : '');
  };

  return (
    <AppSection label="Change Password" mt={2}>
      <AppFieldInput
        label="New Password"
        type="password"
        value={next}
        onChange={(val) => update(val, confirm)}
        fullWidth
        margin="normal"
      />
      <AppFieldInput
        label="Confirm New Password"
        type="password"
        value={confirm}
        onChange={(val) => update(next, val)}
        fullWidth
        margin="normal"
      />
      {mismatch && (
        <AppText color="error" variant="body2" className="password-mismatch">
          The new passwords do not match. The password will not change until they match.
        </AppText>
      )}
    </AppSection>
  );
}
