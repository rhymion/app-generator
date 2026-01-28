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
