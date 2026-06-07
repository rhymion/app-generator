import type { ModelPermissions } from '@/lib/authz';

export type DbTable = {
  id: string;
  name: string;
  description: string | null;
  commentable_id: string;
  creator_id: string | null;
  commentable?: {
    id: string;
    comments: {
      id: string;
      message: string;
      commentable_id: string;
      created_at?: string | Date | null;
      updated_at?: string | Date | null;
      creator?: { id: string; name: string; image?: string | null } | null;
      reactionCounts: Array<{ type: number; count: number }>;
      myReactionTypes: number[];
    }[];
  } | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type DbTableDetail = DbTable & {
  fields: Field[];
};

export type Field = {
  id: string;
  name: string;
  type: string;
  db_table_id: string;
  reference_id: string | null;
  max_length: number;
  max: number | null;
  regex: string | null;
  required: boolean;
  reference?: DbTable | null;
};

export type CommentReactionSummary = {
  commentId: string;
  type: number;
  active: boolean;
  counts: Array<{ type: number; count: number }>;
  myTypes: number[];
};

export type DbTableDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    fields: Field[];
    commentable?: {
      id: string;
      comments: {
        id: string;
        message: string;
        commentable_id: string;
        created_at?: string | Date | null;
        updated_at?: string | Date | null;
        creator?: { id: string; name: string; image?: string | null } | null;
        reactionCounts: Array<{ type: number; count: number }>;
        myReactionTypes: number[];
      }[];
    } | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialDbTables?: DbTable[];
  searchDbTableOptions?: (query: string, includeIds: string[]) => Promise<DbTable[]>;
  currentUserId?: string | null;
}>;
