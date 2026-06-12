import { Chip } from '@mui/material';

type Color = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
type Size = 'small' | 'medium';

interface AppChipProps {
  label: string;
  color?: Color;
  size?: Size;
  className?: string;
}

export default function AppChip({ label, color, size, className }: AppChipProps) {
  return <Chip label={label} color={color} size={size} className={className} />;
}
