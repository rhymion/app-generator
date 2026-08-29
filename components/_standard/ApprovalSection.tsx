'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import UndoIcon from '@mui/icons-material/Undo';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Fragment } from 'react';
import type { ModelPermissions } from '@/lib/authz';
import { approveApprovalRequest, rejectApprovalRequest, withdrawApprovalRequest } from '@/lib/approval_request/actions';
import { canSubmitForApproval, canWithdrawApproval } from '@/lib/approval_request/submit_predicate';

const STATUS_LABELS = ['Pending', 'Approved', 'Rejected', 'TerminalRejected', 'Withdrawn'] as const;

const REASON_KIND_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Customer' },
  { value: 1, label: 'Internal' },
];

type ApprovalHistory = {
  id: string;
  pre_status: number;
  post_status: number;
  message?: string | null;
  created_at: Date | string;
  creator?: { id: string; name: string } | null;
};

type ApprovalRequest = {
  id: string;
  approval_flow_id: string;
  // cmd_844: identifies which submission ("round") this row belongs to --
  // see prisma/schema.prisma's approval_request.round_id doc.
  round_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'terminal_rejected' | 'withdrawn';
  approval_flow?: {
    id: string;
    entity_name: string;
    approver_role_id?: string | null;
    requestor_role_id?: string | null;
    approver_role?: { id: string; name: string } | null;
    preceded_by?: { id: string }[];
  } | null;
  approval_histories?: ApprovalHistory[];
};

type Action = 'approve' | 'reject' | 'withdraw';

type Props = {
  src: { id: string; approvable?: { id: string; creator_id?: string | null; approval_requests: ApprovalRequest[] } | null };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  // cmd_825: revived for the withdraw button's own-request check below --
  // form_view.tsx.jinja2's generic x-custom-components wiring already
  // always passes currentUserId to every view-target component, so no
  // template change was needed to make it available here again.
  currentUserId?: string | null;
  onSubmitForApproval?: () => Promise<void>;
  // cmd_865: whether this entity declares x-approval.on_withdrawn
  // (generators.py's form_view_context, threaded via form_view.tsx.jinja2).
  // The server-side withdraw lockout (on_withdrawn_dispatch.ts's
  // ENTITIES_WITH_ON_WITHDRAWN) rejects a withdrawal for any entity where
  // this is false, so the button is hidden here rather than left to fail.
  hasOnWithdrawn?: boolean;
};

// cmd_844: split the full (ascending-created_at-ordered, see
// build_context.py's approval_request child include) approval_requests
// array into the current round (the round_id of the last row) and every
// past round, grouped by round_id, most-recent-first. An empty array
// yields an empty current round and no past rounds.
function splitRounds(requests: ApprovalRequest[]): {
  currentRoundRequests: ApprovalRequest[];
  pastRounds: ApprovalRequest[][];
} {
  if (requests.length === 0) return { currentRoundRequests: [], pastRounds: [] };
  const currentRoundId = requests[requests.length - 1].round_id;
  const currentRoundRequests = requests.filter((r) => r.round_id === currentRoundId);
  const pastByRound = new Map<string, ApprovalRequest[]>();
  for (const r of requests) {
    if (r.round_id === currentRoundId) continue;
    const bucket = pastByRound.get(r.round_id);
    if (bucket) bucket.push(r); else pastByRound.set(r.round_id, [r]);
  }
  // Map preserves insertion order (ascending created_at) -- reverse for
  // most-recent-past-round-first display.
  const pastRounds = Array.from(pastByRound.values()).reverse();
  return { currentRoundRequests, pastRounds };
}

export default function ApprovalSection({ src, currentUserRoleIds, currentUserId, onSubmitForApproval, hasOnWithdrawn }: Props) {
  const t = useTranslations('Fields');
  const tCommon = useTranslations('Common');
  const tStatus = useTranslations('ApprovalRequestStatus');
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ targetId: string; action: Action } | null>(null);
  const [message, setMessage] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedReasonKind, setSelectedReasonKind] = useState<number | undefined>(undefined);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const requests = src.approvable?.approval_requests ?? [];
  // cmd_841 ruling_4: a "(re)submit" button may need to render even with
  // zero approval_request rows yet (a fresh draft that has never been
  // submitted) or after every row has resolved to a non-blocking state --
  // so the old "no requests -> render nothing" early return must not fire
  // when a submit action is available at all.
  if (requests.length === 0 && !onSubmitForApproval) return null;

  const { currentRoundRequests, pastRounds } = splitRounds(requests);
  const canSubmit = !!onSubmitForApproval && canSubmitForApproval(currentRoundRequests);
  const canWithdrawRound = !!hasOnWithdrawn
    && !!currentUserId
    && src.approvable?.creator_id === currentUserId
    && canWithdrawApproval(currentRoundRequests);

  // cmd_844 (subtask_844b section_2): built from currentRoundRequests
  // ONLY, never the full unscoped requests array -- an unscoped Map lets a
  // past round's approved row on the same flow_id "win" over the current
  // round's own not-yet-approved row on that flow_id whenever the
  // include's row order doesn't happen to put the current round last
  // (confirmed reproducible after a Postgres CLUSTER reorders the table's
  // heap; the include's `orderBy: { created_at: 'asc' }`, added alongside
  // this fix, makes normal reads safe too, but scoping to
  // currentRoundRequests removes the dependency on ordering entirely for
  // this specific computation).
  const flowIdToStatus = new Map(currentRoundRequests.map((r) => [r.approval_flow_id, r.status]));

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openDialog = (targetId: string, action: Action) => {
    setMessage('');
    setRejectionReason('');
    setSelectedReasonKind(undefined);
    setDialog({ targetId, action });
  };

  const closeDialog = () => setDialog(null);

  const confirmAction = () => {
    if (!dialog) return;
    const { targetId, action } = dialog;
    const msg = message.trim() || undefined;
    const reasonText = rejectionReason.trim() || undefined;
    const reasonKind = selectedReasonKind;
    closeDialog();
    startTransition(() => {
      if (action === 'approve') approveApprovalRequest(targetId, msg);
      else if (action === 'reject') rejectApprovalRequest(targetId, msg, { reason: reasonText, reasonKind });
      // cmd_844: withdraw's targetId is the approvable id, not a specific
      // approval_request id -- withdrawal closes every pending row of the
      // current round in one action (see actions_core.ts's
      // withdrawApprovalRequest).
      else withdrawApprovalRequest(targetId, msg);
    });
  };

  const dialogTitle = dialog?.action === 'approve' ? t('approve')
    : dialog?.action === 'reject' ? t('reject')
    : t('withdraw');

  const handleSubmitForApproval = () => {
    if (!onSubmitForApproval) return;
    startTransition(() => {
      onSubmitForApproval();
    });
  };

  const renderRequestRow = (ar: ApprovalRequest, actionable: boolean) => {
    const approverRoleId = ar.approval_flow?.approver_role_id;
    const precedingFlowIds = ar.approval_flow?.preceded_by?.map((f) => f.id) ?? [];
    const precedingApproved = precedingFlowIds.every(
      (fid) => flowIdToStatus.get(fid) === 'approved',
    );
    const canAct = actionable
      && ar.status === 'pending'
      && approverRoleId
      && currentUserRoleIds?.includes(approverRoleId)
      && precedingApproved;
    const histories = ar.approval_histories ?? [];
    const isExpanded = expandedIds.has(ar.id);

    return (
      <Fragment key={ar.id}>
        <TableRow>
          <TableCell>{ar.approval_flow?.approver_role?.name ?? '-'}</TableCell>
          <TableCell>{tStatus(ar.status)}</TableCell>
          <TableCell>
            {histories.length > 0 && (
              <Tooltip title={isExpanded ? 'Hide history' : 'Show history'}>
                <IconButton size="small" onClick={() => toggleExpanded(ar.id)} aria-label={isExpanded ? 'Collapse history' : 'Expand history'}>
                  {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
          </TableCell>
          <TableCell>
            {canAct && (
              <>
                <Tooltip title={t('approve')}>
                  <IconButton aria-label="Approve" color="success" size="small" onClick={() => openDialog(ar.id, 'approve')}>
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('reject')}>
                  <IconButton aria-label="Reject" color="error" size="small" onClick={() => openDialog(ar.id, 'reject')}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </TableCell>
        </TableRow>
        {histories.length > 0 && (
          <TableRow key={`${ar.id}-history`}>
            <TableCell colSpan={4} sx={{ py: 0 }}>
              <Collapse in={isExpanded} unmountOnExit>
                <Box sx={{ p: 1 }}>
                  {histories.map((h) => (
                    <Box key={h.id} sx={{ mb: 0.5 }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {new Date(h.created_at).toLocaleString()} — {h.creator?.name ?? '—'} :
                        {' '}{STATUS_LABELS[h.pre_status] ?? h.pre_status} → {STATUS_LABELS[h.post_status] ?? h.post_status}
                      </Typography>
                      {h.message && (
                        <Typography variant="body2" sx={{ ml: 1 }}>&quot;{h.message}&quot;</Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2>{t('approvalRequests')}</h2>
      {canSubmit && (
        // cmd_843: PD-3 ruling -- one label for both the first submission
        // and any later resubmission, no first-vs-again wording split.
        <Tooltip title={t('submit')}>
          <Button variant="contained" aria-label={t('submit')} onClick={handleSubmitForApproval} sx={{ mb: 1 }}>
            {t('submit')}
          </Button>
        </Tooltip>
      )}
      {currentRoundRequests.length === 0 ? null : (
      <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('approverRole')}</TableCell>
            <TableCell>{t('status')}</TableCell>
            <TableCell>{t('approvalHistory')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {currentRoundRequests.map((ar) => renderRequestRow(ar, true))}
        </TableBody>
      </Table>
      {canWithdrawRound && (
        // cmd_844 (PD-1 final ruling): withdrawal is round-level, not
        // per-row -- one button for the whole current round, closing every
        // still-pending row of it (approved rows are left untouched).
        <Tooltip title={t('withdraw')}>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<UndoIcon fontSize="small" />}
            aria-label="Withdraw"
            size="small"
            onClick={() => src.approvable && openDialog(src.approvable.id, 'withdraw')}
            sx={{ mt: 1 }}
          >
            {t('withdraw')}
          </Button>
        </Tooltip>
      )}
      </>
      )}

      {pastRounds.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Tooltip title={historyExpanded ? 'Hide history' : 'Show history'}>
            <Button
              size="small"
              onClick={() => setHistoryExpanded((v) => !v)}
              startIcon={historyExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            >
              {t('pastSubmissions')}
            </Button>
          </Tooltip>
          <Collapse in={historyExpanded} unmountOnExit>
            {pastRounds.map((round, idx) => (
              <Table size="small" key={round[0]?.round_id ?? idx} sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('approverRole')}</TableCell>
                    <TableCell>{t('status')}</TableCell>
                    <TableCell>{t('approvalHistory')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {round.map((ar) => renderRequestRow(ar, false))}
                </TableBody>
              </Table>
            ))}
          </Collapse>
        </Box>
      )}

      <Dialog open={!!dialog} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('message')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            multiline
            rows={3}
            fullWidth
            margin="normal"
            placeholder="Optional message..."
          />
          {dialog?.action === 'reject' && (
            <>
              <FormControl fullWidth margin="normal">
                <InputLabel id="reason-kind-label">Reason</InputLabel>
                <Select
                  labelId="reason-kind-label"
                  label="Reason"
                  value={selectedReasonKind ?? ''}
                  onChange={(e: SelectChangeEvent<number | string>) => {
                    const v = e.target.value;
                    setSelectedReasonKind(v === '' ? undefined : Number(v));
                  }}
                >
                  <MenuItem value="">(unspecified)</MenuItem>
                  {REASON_KIND_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Rejection reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                multiline
                rows={2}
                fullWidth
                margin="normal"
                placeholder="Optional rejection reason..."
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{tCommon('cancel')}</Button>
          <Button onClick={confirmAction} variant="contained">{dialogTitle}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
