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
import ReplayIcon from '@mui/icons-material/Replay';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Fragment } from 'react';
import type { ModelPermissions } from '@/lib/authz';
import { approveApprovalRequest, rejectApprovalRequest, resubmitApprovalRequest } from '@/lib/approval_request/actions';

const STATUS_LABELS = ['Pending', 'Approved', 'Rejected', 'TerminalRejected'] as const;

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
  status: 'pending' | 'approved' | 'rejected' | 'terminal_rejected';
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

type Action = 'approve' | 'reject' | 'resubmit';

type Props = {
  src: { creator_id?: string | null; approvable?: { id: string; approval_requests: ApprovalRequest[] } | null };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
};

export default function ApprovalSection({ src, currentUserRoleIds, currentUserId }: Props) {
  const t = useTranslations('Fields');
  const tCommon = useTranslations('Common');
  const tStatus = useTranslations('ApprovalRequestStatus');
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ arId: string; action: Action } | null>(null);
  const [message, setMessage] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedReasonKind, setSelectedReasonKind] = useState<number | undefined>(undefined);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const requests = src.approvable?.approval_requests ?? [];
  if (requests.length === 0) return null;

  // Build a map of flow_id → status for ordering checks
  const flowIdToStatus = new Map(requests.map((r) => [r.approval_flow_id, r.status]));

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openDialog = (arId: string, action: Action) => {
    setMessage('');
    setRejectionReason('');
    setSelectedReasonKind(undefined);
    setDialog({ arId, action });
  };

  const closeDialog = () => setDialog(null);

  const confirmAction = () => {
    if (!dialog) return;
    const { arId, action } = dialog;
    const msg = message.trim() || undefined;
    const reasonText = rejectionReason.trim() || undefined;
    const reasonKind = selectedReasonKind;
    closeDialog();
    startTransition(() => {
      if (action === 'approve') approveApprovalRequest(arId, msg);
      else if (action === 'reject') rejectApprovalRequest(arId, msg, { reason: reasonText, reasonKind });
      else resubmitApprovalRequest(arId, msg);
    });
  };

  const dialogTitle =
    dialog?.action === 'approve' ? t('approve') :
    dialog?.action === 'reject'  ? t('reject') :
    t('resubmit');

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2>{t('approvalRequests')}</h2>
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
          {requests.map((ar) => {
            const approverRoleId = ar.approval_flow?.approver_role_id;
            const requestorRoleId = ar.approval_flow?.requestor_role_id;
            const precedingFlowIds = ar.approval_flow?.preceded_by?.map((f) => f.id) ?? [];
            const precedingApproved = precedingFlowIds.every(
              (fid) => flowIdToStatus.get(fid) === 'approved',
            );
            const canAct = ar.status === 'pending'
              && approverRoleId
              && currentUserRoleIds?.includes(approverRoleId)
              && precedingApproved;
            const canResubmit = ar.status === 'rejected' && (
              currentUserId === src.creator_id ||
              (requestorRoleId ? currentUserRoleIds?.includes(requestorRoleId) : false)
            );
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
                    {canResubmit && (
                      <Tooltip title={t('resubmit')}>
                        <IconButton aria-label="Re-submit" color="primary" size="small" onClick={() => openDialog(ar.id, 'resubmit')}>
                          <ReplayIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
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
                              <Typography variant="caption" color="text.secondary">
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
          })}
        </TableBody>
      </Table>

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
