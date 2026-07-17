import IconButton from '@mui/material/IconButton';
import AppIcon from './AppIcon';

type Color = 'inherit' | 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';

interface AppIconButtonProps {
  iconName: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  label?: string;
  title?: string;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  edge?: 'start' | 'end' | false;
  iconFontSize?: 'small' | 'medium' | 'large' | 'inherit';
  color?: Color;
  /** Polymorphic: pass Link component + href for link-style icon buttons */
  component?: React.ElementType;
  href?: string;
  target?: string;
  rel?: string;
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
  color,
  component,
  href,
  target,
  rel,
}: AppIconButtonProps) {
  const polyProps: Record<string, unknown> = {};
  if (component !== undefined) polyProps.component = component;
  if (href !== undefined) polyProps.href = href;
  if (target !== undefined) polyProps.target = target;
  if (rel !== undefined) polyProps.rel = rel;

  // Spread polymorphic props (component+href+target+rel) through a typed escape hatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polySpread = polyProps as any;

  return (
    <IconButton
      onClick={onClick}
      aria-label={label}
      title={title}
      disabled={disabled}
      size={size}
      edge={edge}
      color={color}
      {...polySpread}
    >
      <AppIcon name={iconName} fontSize={iconFontSize} />
    </IconButton>
  );
}
