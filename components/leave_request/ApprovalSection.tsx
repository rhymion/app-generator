'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import type { ModelPermissions } from '@/lib/authz';
import { approveApprovalRequest, rejectApprovalRequest } from '@/lib/approval_request/actions';

const STATUS_LABELS = ['Pending', 'Approved', 'Rejected'] as const;

type ApprovalRequest = {
  id: string;
  status: number;
  approval_flow?: {
    id: string;
    entity_name: string;
    approver_role_id?: string | null;
    approver_role?: { id: string; name: string } | null;
  } | null;
};

type Props = {
  src: { approvable?: { id: string; approval_requests: ApprovalRequest[] } | null };
  permissions?: ModelPermissions;
};

export default function ApprovalSection({ src }: Props) {
  const t = useTranslations('Fields');
  const [, startTransition] = useTransition();

  const requests = src.approvable?.approval_requests ?? [];
  if (requests.length === 0) return null;

  const handleApprove = (id: string) => {
    startTransition(() => { approveApprovalRequest(id); });
  };
  const handleReject = (id: string) => {
    startTransition(() => { rejectApprovalRequest(id); });
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2>{t('approvalRequests')}</h2>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('approverRole')}</TableCell>
            <TableCell>{t('status')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {requests.map((ar) => (
            <TableRow key={ar.id}>
              <TableCell>{ar.approval_flow?.approver_role?.name ?? '-'}</TableCell>
              <TableCell>{STATUS_LABELS[ar.status] ?? ar.status}</TableCell>
              <TableCell>
                {ar.status === 0 && (
                  <>
                    <Tooltip title="Approve">
                      <IconButton
                        aria-label="Approve"
                        color="success"
                        size="small"
                        onClick={() => handleApprove(ar.id)}
                      >
                        <CheckIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reject">
                      <IconButton
                        aria-label="Reject"
                        color="error"
                        size="small"
                        onClick={() => handleReject(ar.id)}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
