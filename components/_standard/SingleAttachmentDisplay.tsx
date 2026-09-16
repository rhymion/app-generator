export type SingleAttachmentDisplayKind = 'image' | 'file' | 'video' | 'audio';

interface SingleAttachmentDisplayProps {
  url: string | null;
  /** Original file name, used as the visible label for a non-image kind and
   * as the <img> alt/title fallback. Falls back to the last URL segment
   * when omitted. */
  name?: string | null;
  kind: SingleAttachmentDisplayKind;
  alt?: string;
  maxWidth?: string;
  maxHeight?: string;
}

export default function SingleAttachmentDisplay({
  url,
  name,
  kind,
  alt = 'Attachment',
  maxWidth = '200px',
  maxHeight = '200px',
}: SingleAttachmentDisplayProps) {
  if (!url) return null;

  const label = name || url.split('/').slice(-1)[0];

  if (kind === 'image') {
    return (
      <div style={{ marginTop: '8px' }}>
        {/* url is an arbitrary uploaded-file URL of unknown origin/dimensions; next/image
            needs a configured remote pattern and fixed dimensions, out of scope here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          title={label}
          style={{
            maxWidth,
            maxHeight,
            objectFit: 'contain',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '4px',
          }}
        />
      </div>
    );
  }

  // Non-image kind (file/video/audio): a download link, not an <img> -- a
  // non-image file has no meaningful thumbnail, and forcing one through
  // ImageDisplay/an <img> tag was the exact defect cmd_776(3) exists to fix.
  return (
    <div style={{ marginTop: '8px' }}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </div>
  );
}
