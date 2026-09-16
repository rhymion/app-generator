import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface AppFieldExternalLinkProps {
  label: React.ReactNode;
  href: string | null | undefined;
}

export default function AppFieldExternalLink({ label, href }: AppFieldExternalLinkProps) {
  return (
    <Box sx={{ mt: 1, mb: 0.5 }}>
      <Typography variant="caption" component="div" sx={{
        color: "text.secondary"
      }}>
        {label}
      </Typography>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: '1rem', wordBreak: 'break-all' }}>
          {href}
        </a>
      ) : (
        <Typography variant="body1" sx={{
          color: "text.disabled"
        }}>—</Typography>
      )}
    </Box>
  );
}
