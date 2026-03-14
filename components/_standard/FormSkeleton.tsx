import Skeleton from '@mui/material/Skeleton';
import Box from '@mui/material/Box';

interface FormSkeletonProps {
  fields?: number;
}

export default function FormSkeleton({ fields = 4 }: FormSkeletonProps) {
  return (
    <div>
      {/* Title row: mirrors "flex justify-between items-center mb-4" */}
      <div className="flex justify-between items-center mb-4">
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="circular" width={36} height={36} />
      </div>
      {/* Form fields: mimic MUI TextField with margin="normal" (top: 16px, bottom: 8px) */}
      {Array.from({ length: fields }).map((_, i) => (
        <Box key={i} sx={{ mt: 2, mb: 1 }}>
          <Skeleton variant="text" width={120} height={18} sx={{ mb: 0.5 }} />
          <Skeleton variant="rectangular" height={56} />
        </Box>
      ))}
      {/* Submit / Delete buttons */}
      <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
        <Skeleton variant="circular" width={36} height={36} />
        <Skeleton variant="circular" width={36} height={36} />
      </Box>
    </div>
  );
}
