import { Button } from '@mui/material';
import React from 'react';

type Variant = 'contained' | 'outlined' | 'text';
type Color = 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'inherit';
type Size = 'small' | 'medium' | 'large';

interface AppButtonProps {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  variant?: Variant;
  color?: Color;
  size?: Size;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  mt?: number;
  mb?: number;
  className?: string;
  /** Polymorphic: pass Link component + href for link-buttons */
  component?: React.ElementType;
  href?: string;
  'aria-label'?: string;
}

export default function AppButton({
  children,
  onClick,
  variant = 'contained',
  color,
  size = 'medium',
  disabled,
  type,
  fullWidth,
  startIcon,
  endIcon,
  mt,
  mb,
  className,
  component,
  href,
  'aria-label': ariaLabel,
}: AppButtonProps) {
  const polyProps: Record<string, unknown> = {};
  if (component !== undefined) polyProps.component = component;
  if (href !== undefined) polyProps.href = href;

  const sxInternal: Record<string, unknown> = {};
  if (mt !== undefined) sxInternal.mt = mt;
  if (mb !== undefined) sxInternal.mb = mb;

  // Spread polymorphic props (component+href) through a typed escape hatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polySpread = polyProps as any;

  return (
    <Button
      onClick={onClick}
      variant={variant}
      color={color}
      size={size}
      disabled={disabled}
      type={type}
      fullWidth={fullWidth}
      startIcon={startIcon}
      endIcon={endIcon}
      className={className}
      aria-label={ariaLabel}
      sx={Object.keys(sxInternal).length > 0 ? sxInternal : undefined}
      {...polySpread}
    >
      {children}
    </Button>
  );
}
