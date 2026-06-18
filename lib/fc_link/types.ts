import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';
import type { Character } from '@/lib/character/types';
import type { Music } from '@/lib/music/types';
import type { Channel } from '@/lib/channel/types';

export type FcLink = {
  id: string;
  name: string;
  url: string;
  creator_id: string | null;
  parent_type?: string | null;
  parent_label?: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type FcLinkDetail = FcLink;

export type FcLinkDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    url: string;
    parent_type?: string | null;
    parent_label?: string | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialWorks?: Work[];
  searchWorkOptions?: (query: string, includeIds: string[]) => Promise<Work[]>;
  initialCharacters?: Character[];
  searchCharacterOptions?: (query: string, includeIds: string[]) => Promise<Character[]>;
  initialMusics?: Music[];
  searchMusicOptions?: (query: string, includeIds: string[]) => Promise<Music[]>;
  initialChannels?: Channel[];
  searchChannelOptions?: (query: string, includeIds: string[]) => Promise<Channel[]>;
  currentUserId?: string | null;
  /** Parent context for create, supplied by the parent-embedded grid (/new?parentType=&parentId=). */
  initialParentType?: string;
  initialParentId?: string;
}>;
