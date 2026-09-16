'use client';

import { useState } from 'react';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import SingleAttachmentDisplay, { type SingleAttachmentDisplayKind } from './SingleAttachmentDisplay';

export type SingleAttachmentFk = {
  id: string;
  name: string;
  path: string;
  type: SingleAttachmentDisplayKind;
};

type SingleAttachmentUploadProps =
  | {
      /** A plain URL-string field (x-uri-kind: image | file, cmd_776(3)):
       * value/onChange carry the URL directly, same contract as ImageUpload. */
      mode: 'url';
      kind: 'image' | 'file';
      value: string;
      onChange: (url: string) => void;
      label?: string;
      helperText?: string;
    }
  | {
      /** A direct-attachment FK field (x-relationship type:direct, cmd_788):
       * value/onChange carry the whole attachment descriptor -- the form
       * submits only `value.id` (see form_upsert_context's
       * direct_attachment_ds), the descriptor is kept in full so the
       * uploaded file's name/path/type can be redisplayed without a second
       * round trip.
       *
       * `createAttachment` is injected (not imported directly, unlike
       * ImageUpload's plain /api/upload fetch) rather than a static
       * `import { createDirectAttachment } from '@/lib/attachment/
       * direct_actions'` here: that path is a per-run GENERATED file (like
       * lib/attachment/bridge_actions.ts), absent from this repo's own
       * working tree until generate-code runs, and a component-level static
       * import of it would make this file's own module graph unresolvable
       * outside a post-generate-code build -- unlike FormUpsert.tsx, which
       * IS itself always freshly generated alongside lib/attachment/
       * direct_actions.ts and so can safely import it directly (see
       * form_upsert_context's has_single_attachment_upload_fk wiring). This
       * also keeps this component dependency-free and fully unit-testable. */
      mode: 'fk';
      value: SingleAttachmentFk | null;
      onChange: (next: SingleAttachmentFk | null) => void;
      createAttachment: (name: string, path: string, type: SingleAttachmentDisplayKind) => Promise<SingleAttachmentFk>;
      label?: string;
      helperText?: string;
    };

const ACCEPT_URL: Record<'image' | 'file', string> = {
  image: 'image/jpeg,image/png,image/gif,image/webp',
  file: '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,image/jpeg,image/png,image/gif,image/webp',
};
const ACCEPT_FK = ACCEPT_URL.file;

function detectKind(file: File): SingleAttachmentDisplayKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

export default function SingleAttachmentUpload(props: SingleAttachmentUploadProps) {
  const { label = 'attachment', helperText = 'You can upload a file' } = props;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tf = useTranslations('Fields');

  const displayUrl = props.mode === 'fk' ? (props.value?.path ?? null) : props.value || null;
  const displayName = props.mode === 'fk' ? (props.value?.name ?? null) : null;
  const displayKind: SingleAttachmentDisplayKind = props.mode === 'fk' ? (props.value?.type ?? 'file') : props.kind;

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

      if (props.mode === 'url') {
        props.onChange(data.url);
      } else {
        const attachment = await props.createAttachment(file.name, data.url, detectKind(file));
        props.onChange(attachment);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Allow re-selecting the same file (browsers don't fire `change` for
      // an identical file path otherwise).
      event.target.value = '';
    }
  };

  const handleRemove = () => {
    setError(null);
    if (props.mode === 'url') {
      props.onChange('');
    } else {
      props.onChange(null);
    }
  };

  const accept = props.mode === 'url' ? ACCEPT_URL[props.kind] : ACCEPT_FK;
  const inputId = `single-attachment-upload-${label}`;

  return (
    <div style={{ margin: '16px 0' }}>
      <input
        accept={accept}
        style={{ display: 'none' }}
        id={inputId}
        data-testid={`${inputId}-file`}
        type="file"
        onChange={handleFileUpload}
        disabled={uploading}
      />
      {/* The Remove button is a SIBLING of this <label>, never a descendant --
          a clickable nested inside a <label for=...> forwards its click to
          the hidden file input (the same defect class cmd_776(4)'s
          datagrid-helpers fix worked around downstream; this avoids
          reintroducing it upstream in a brand-new component). */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <label htmlFor={inputId} style={{ flex: 1 }}>
          <TextField
            label={tf(label)}
            value={displayUrl ? displayName || displayUrl.split('/').slice(-1)[0] : ''}
            fullWidth
            margin="normal"
            helperText={error || helperText}
            error={!!error}
            slotProps={{
              htmlInput: { 'data-testid': `${inputId}-value` },
              input: {
                readOnly: true,
                endAdornment: (
                  <span style={{ marginLeft: '8px', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => document.getElementById(inputId)?.click()}
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
              },
            }}
          />
        </label>
        {displayUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={uploading}
            style={{
              marginTop: '24px',
              padding: '8px 16px',
              backgroundColor: uploading ? '#ccc' : '#fff',
              color: '#d32f2f',
              border: '1px solid #d32f2f',
              borderRadius: '4px',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            Remove
          </button>
        )}
      </div>
      <SingleAttachmentDisplay url={displayUrl} name={displayName} kind={displayKind} alt={tf(label)} />
    </div>
  );
}
