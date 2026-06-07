'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

export type CommentReactionCount = { type: number; count: number };
export type CommentReactionSummary = {
  commentId: string;
  type: number;
  active: boolean;
  counts: CommentReactionCount[];
  myTypes: number[];
};
export type ReactionType = { value: number; label: string };

interface CommentReactionBarProps {
  commentId: string;
  counts: CommentReactionCount[];
  myTypes: number[];
  onToggle: (type: number) => Promise<CommentReactionSummary>;
  types: ReactionType[];
}

export default function CommentReactionBar({
  commentId: _commentId,
  counts: initialCounts,
  myTypes: initialMyTypes,
  onToggle,
  types,
}: CommentReactionBarProps) {
  const [counts, setCounts] = useState<CommentReactionCount[]>(initialCounts);
  const [myTypes, setMyTypes] = useState<number[]>(initialMyTypes);
  const [pendingType, setPendingType] = useState<number | null>(null);

  const getCount = (type: number) => counts.find((c) => c.type === type)?.count ?? 0;

  const handleToggle = async (type: number) => {
    if (pendingType !== null) return;
    const prevCounts = counts;
    const prevMyTypes = myTypes;
    setPendingType(type);
    try {
      const result = await onToggle(type);
      setCounts(result.counts);
      setMyTypes(result.myTypes);
    } catch {
      setCounts(prevCounts);
      setMyTypes(prevMyTypes);
    } finally {
      setPendingType(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
      {types.map(({ value, label }) => {
        const isActive = myTypes.includes(value);
        const isPending = pendingType === value;
        const count = getCount(value);
        return (
          <Button
            key={value}
            size="small"
            variant={isActive ? 'contained' : 'outlined'}
            color="primary"
            onClick={() => handleToggle(value)}
            disabled={isPending}
            startIcon={isPending ? <CircularProgress size={12} color="inherit" /> : undefined}
            aria-label={label}
            aria-pressed={isActive}
          >
            {label}
            {count > 0 && <Box component="span" sx={{ ml: 0.5 }}>{count}</Box>}
          </Button>
        );
      })}
    </Box>
  );
}
