import type { ModelPermissions } from '@/lib/authz';
import type { Comment } from '@/lib/comment/types';

export type TipTx = {
  id: string;
  gross_amount: number;
  operator_fee: number;
  payment_fee: number;
  contract_split_id: string;
  status: number;
  comment_id: string;
  creator_id: string | null;
  updated_at?: string;
  comment?: Comment | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type CommentOption = {
  id: string;
  label: string;
};

export type TipTxDetail = TipTx;

export type TipTxDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    gross_amount: number | null;
    operator_fee: number | null;
    payment_fee: number | null;
    contract_split_id: string;
    status: number | null;
    comment_id: string;
    comment?: Comment | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialComments?: Comment[];
  searchCommentOptions?: (query: string, includeIds: string[]) => Promise<Comment[]>;
  currentUserId?: string | null;
}>;
