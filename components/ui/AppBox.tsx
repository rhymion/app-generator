import { Box } from '@mui/material';
import React from 'react';

interface AppBoxProps {
  children?: React.ReactNode;
  display?: string;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: string;
  alignItems?: string;
  gap?: number | string;
  minHeight?: string | number;
  textAlign?: 'left' | 'center' | 'right';
  maxWidth?: number | string;
  p?: number;
  px?: number;
  py?: number;
  pt?: number;
  pb?: number;
  mx?: string | number;
  mt?: number | string;
  mb?: number | string;
  bgcolor?: string;
  borderRadius?: number;
  gridTemplateColumns?: string;
  fontFamily?: string;
  overflowX?: string;
  component?: React.ElementType;
  onSubmit?: React.FormEventHandler<HTMLElement>;
  className?: string;
}

export default function AppBox({
  children,
  display,
  flexDirection,
  justifyContent,
  alignItems,
  gap,
  minHeight,
  textAlign,
  maxWidth,
  p,
  px,
  py,
  pt,
  pb,
  mx,
  mt,
  mb,
  bgcolor,
  borderRadius,
  gridTemplateColumns,
  fontFamily,
  overflowX,
  component,
  onSubmit,
  className,
}: AppBoxProps) {
  const sx: Record<string, unknown> = {};
  if (gridTemplateColumns !== undefined) sx.gridTemplateColumns = gridTemplateColumns;
  if (fontFamily !== undefined) sx.fontFamily = fontFamily;
  if (bgcolor !== undefined) sx.bgcolor = bgcolor;
  if (borderRadius !== undefined) sx.borderRadius = borderRadius;
  if (overflowX !== undefined) sx.overflowX = overflowX;

  return (
    <Box
      onSubmit={onSubmit}
      className={className}
      {...(component !== undefined ? { component } : {})}
      sx={[{
        display: display,
        flexDirection: flexDirection,
        justifyContent: justifyContent,
        alignItems: alignItems,
        gap: gap,
        minHeight: minHeight,
        textAlign: textAlign,
        maxWidth: maxWidth,
        p: p,
        px: px,
        py: py,
        pt: pt,
        pb: pb,
        mx: mx,
        mt: mt,
        mb: mb
      }, Object.keys(sx).length > 0 ? sx : false]}>
      {children}
    </Box>
  );
}
