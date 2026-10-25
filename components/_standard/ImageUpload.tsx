'use client';

import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';

// A URL field with an image preview. The value is a plain URL string (an external image address);
// files are uploaded through a direct-attachment field (x-relationship type: direct) instead, which
// stores the file as an attachment delivered by an authorized route.
interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  helperText?: string;
}

export default function ImageUpload({
  value,
  onChange,
  label = 'imageUrl',
  helperText = 'You can paste a URL'
}: ImageUploadProps) {
  const tf = useTranslations('Fields');

  return (
    <div style={{ margin: '16px 0' }}>
      <TextField
        label={tf(label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        fullWidth
        margin="normal"
        helperText={helperText}
      />
      {value && (
        <div style={{ marginTop: '8px' }}>
          {/* value is an arbitrary image URL of unknown origin/dimensions; next/image
              needs a configured remote pattern and fixed dimensions, out of scope here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Preview"
            style={{
              maxWidth: '200px',
              maxHeight: '200px',
              objectFit: 'contain',
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '4px'
            }}
          />
        </div>
      )}
    </div>
  );
}
