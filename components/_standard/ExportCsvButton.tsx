'use client';

import Button from '@mui/material/Button';

interface ExportCsvButtonProps {
  entity: string;
  apiKey: string | null;
}

export default function ExportCsvButton({ entity, apiKey }: ExportCsvButtonProps) {
  async function handleExport() {
    if (!apiKey) return;
    const res = await fetch(`/api/${entity}/export`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outlined" size="small" onClick={handleExport} disabled={!apiKey}>
      Export CSV
    </Button>
  );
}
