import type { ModelPermissions } from '@/lib/authz';
import type { Organization } from '@/lib/organization/types';
import type { Work } from '@/lib/work/types';
import type { Character } from '@/lib/character/types';
import type { Scene } from '@/lib/scene/types';

export type Channel = {
  id: string;
  name: string;
  kind: number;
  organization_id: string;
  commentable_id: string;
  creator_id: string | null;
  parent_type?: string | null;
  parent_label?: string | null;
  organization?: Organization | null;
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

export type OrganizationOption = {
  id: string;
  label: string;
};

export type ChannelDetail = Channel;

export type CommentReactionSummary = {
  commentId: string;
  type: number;
  active: boolean;
  counts: Array<{ type: number; count: number }>;
  myTypes: number[];
};

export type ChannelDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    kind: number | null;
    organization_id: string;
    parent_type?: string | null;
    parent_label?: string | null;
    organization?: Organization | null;
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
  initialOrganizations?: Organization[];
  searchOrganizationOptions?: (query: string, includeIds: string[]) => Promise<Organization[]>;
  initialWorks?: Work[];
  searchWorkOptions?: (query: string, includeIds: string[]) => Promise<Work[]>;
  initialCharacters?: Character[];
  searchCharacterOptions?: (query: string, includeIds: string[]) => Promise<Character[]>;
  initialScenes?: Scene[];
  searchSceneOptions?: (query: string, includeIds: string[]) => Promise<Scene[]>;
  currentUserId?: string | null;
  /** Parent context for create, supplied by the parent-embedded grid (/new?parentType=&parentId=). */
  initialParentType?: string;
  initialParentId?: string;
}>;
