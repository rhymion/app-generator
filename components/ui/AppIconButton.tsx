import IconButton from '@mui/material/IconButton';
import AppIcon from './AppIcon';

interface AppIconButtonProps {
  iconName: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  label?: string;
  title?: string;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  edge?: 'start' | 'end' | false;
  iconFontSize?: 'small' | 'medium' | 'large' | 'inherit';
}

export default function AppIconButton({
  iconName,
  onClick,
  label,
  title,
  disabled,
  size,
  edge,
  iconFontSize,
}: AppIconButtonProps) {
  return (
    <IconButton
      onClick={onClick}
      aria-label={label}
      title={title}
      disabled={disabled}
      size={size}
      edge={edge}
    >
      <AppIcon name={iconName} fontSize={iconFontSize} />
    </IconButton>
  );
}
