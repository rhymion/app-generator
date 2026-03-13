import Skeleton from '@mui/material/Skeleton';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export default function TableSkeleton({ rows = 8, columns = 3 }: TableSkeletonProps) {
  return (
    <div>
      {/* Toolbar row: mirrors the Add / Delete buttons area */}
      <div className="flex mb-4">
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Skeleton variant="circular" width={36} height={36} />
          <Skeleton variant="circular" width={36} height={36} />
        </Box>
      </div>
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        {/* Header row */}
        <Box sx={{ display: 'flex', gap: 2, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Skeleton variant="text" width={24} />
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} variant="text" sx={{ flex: 1 }} />
          ))}
          <Skeleton variant="text" width={80} />
        </Box>
        {/* Data rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <Box
            key={rowIdx}
            sx={{
              display: 'flex',
              gap: 2,
              px: 2,
              py: 1.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Skeleton variant="rectangular" width={24} height={20} />
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton key={colIdx} variant="text" sx={{ flex: 1 }} />
            ))}
            <Skeleton variant="text" width={80} />
          </Box>
        ))}
      </Paper>
    </div>
  );
}
