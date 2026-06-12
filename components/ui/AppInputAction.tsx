import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import AppIcon from './AppIcon';

interface AppInputActionProps {
  position: 'start' | 'end';
  iconName: string;
  iconFontSize?: 'small' | 'medium' | 'large' | 'inherit';
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  size?: 'small' | 'medium' | 'large';
  title?: string;
  disabled?: boolean;
}

export default function AppInputAction({
  position,
  iconName,
  iconFontSize,
  onClick,
  size,
  title,
  disabled,
}: AppInputActionProps) {
  return (
    <InputAdornment position={position}>
      <IconButton size={size} onClick={onClick} title={title} disabled={disabled}>
        <AppIcon name={iconName} fontSize={iconFontSize} />
      </IconButton>
    </InputAdornment>
  );
}
