import { Typography } from '@mui/material';
import React from 'react';

type Variant =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'subtitle1' | 'subtitle2'
  | 'body1' | 'body2'
  | 'caption' | 'overline' | 'inherit';

interface AppTextProps {
  children?: React.ReactNode;
  variant?: Variant;
  color?: string;
  fontWeight?: string | number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  mb?: number;
  mt?: number;
  ml?: number;
  p?: number;
  bgcolor?: string;
  borderRadius?: number;
  wordBreak?: string;
  className?: string;
  component?: React.ElementType;
}

export default function AppText({
  children,
  variant,
  color,
  fontWeight,
  fontFamily,
  textAlign,
  mb,
  mt,
  ml,
  p,
  bgcolor,
  borderRadius,
  wordBreak,
  className,
  component,
}: AppTextProps) {
  const sxInternal: Record<string, unknown> = {};
  if (p !== undefined) sxInternal.p = p;
  if (bgcolor !== undefined) sxInternal.bgcolor = bgcolor;
  if (borderRadius !== undefined) sxInternal.borderRadius = borderRadius;
  if (wordBreak !== undefined) sxInternal.wordBreak = wordBreak;

  return (
    <Typography
      variant={variant}
      color={color}
      fontWeight={fontWeight}
      fontFamily={fontFamily}
      textAlign={textAlign}
      mb={mb}
      mt={mt}
      ml={ml}
      className={className}
      component={component as React.ElementType}
      sx={Object.keys(sxInternal).length > 0 ? sxInternal : undefined}
    >
      {children}
    </Typography>
  );
}
