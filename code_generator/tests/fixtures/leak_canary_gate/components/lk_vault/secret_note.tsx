'use client';

// Upsert-only input of the write-only field `secret_note` (the generator never writes this file).
export default function SecretNote({ value, onChange }: { value: string; onChange: (v: string) => void; isEdit?: boolean }) {
  return <input type="password" aria-label="Secret note" value={value} onChange={(e) => onChange(e.target.value)} />;
}
