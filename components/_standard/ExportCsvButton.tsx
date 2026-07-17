'use client';

import Button from '@mui/material/Button';

interface ExportCsvButtonProps {
  entity: string;
}

export default function ExportCsvButton({ entity }: ExportCsvButtonProps) {
  async function handleExport() {
    const res = await fetch(`/api/${entity}/export`);
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
    <Button variant="outlined" size="small" onClick={handleExport}>
      Export CSV
    </Button>
  );
}
