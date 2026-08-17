interface ImageDisplayProps {
  url: string | null;
  alt?: string;
  maxWidth?: string;
  maxHeight?: string;
}

export default function ImageDisplay({ 
  url, 
  alt = 'Image',
  maxWidth = '200px',
  maxHeight = '200px'
}: ImageDisplayProps) {
  if (!url) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      {/* url is an arbitrary uploaded-file URL of unknown origin/dimensions; next/image
          needs a configured remote pattern and fixed dimensions, out of scope here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt} 
        title={url.split('/').slice(-1)[0]}
        style={{ 
          maxWidth, 
          maxHeight, 
          objectFit: 'contain',
          border: '1px solid #ddd',
          borderRadius: '4px',
          padding: '4px'
        }} 
      />
    </div>
  );
}
