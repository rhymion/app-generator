import { CircularProgress } from '@mui/material';

interface AppCircularProgressProps {
  size?: number | string;
}

export default function AppCircularProgress({ size }: AppCircularProgressProps) {
  return <CircularProgress size={size} />;
}
