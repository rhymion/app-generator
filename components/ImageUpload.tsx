'use client';

import { useState } from 'react';
import TextField from '@mui/material/TextField';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  helperText?: string;
}

export default function ImageUpload({ 
  value, 
  onChange, 
  label = 'Image URL',
  helperText = 'You can paste a URL or upload a file'
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await response.json();
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ margin: '16px 0' }}>
      <input
        accept="image/*"
        style={{ display: 'none' }}
        id="image-upload-button"
        type="file"
        onChange={handleFileUpload}
        disabled={uploading}
      />
      <label htmlFor="image-upload-button">
        <TextField
          label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          fullWidth
          margin="normal"
          helperText={error || helperText}
          error={!!error}
          InputProps={{
            endAdornment: (
              <span style={{ marginLeft: '8px', whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  onClick={() => document.getElementById('image-upload-button')?.click()}
                  disabled={uploading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: uploading ? '#ccc' : '#1976d2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: uploading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </span>
            ),
          }}
        />
      </label>
      {value && (
        <div style={{ marginTop: '8px' }}>
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
