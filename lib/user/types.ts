import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';
import type { Character } from '@/lib/character/types';
import type { Scene } from '@/lib/scene/types';
import type { Channel } from '@/lib/channel/types';
import type { Music } from '@/lib/music/types';
import type { Creator } from '@/lib/creator/types';
import type { Plan } from '@/lib/plan/types';

export type User = {
  id: string;
  name: string;
  image: string | null;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type UserDetail = User & {
  roles: Role[];
  sub_accounts: SubAccount[];
  created_works: Work[];
  created_characters: Character[];
  created_scenes: Scene[];
  created_channels: Channel[];
  created_musics: Music[];
  created_creators: Creator[];
  created_plans: Plan[];
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
};

export type SubAccount = {
  id: string;
  parent_user_id: string;
  nickname: string;
  parent_user?: User | null;
};

export type UserDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    image: string | null;
    roles: Role[];
    sub_accounts: SubAccount[];
    created_works: Work[];
    created_characters: Character[];
    created_scenes: Scene[];
    created_channels: Channel[];
    created_musics: Music[];
    created_creators: Creator[];
    created_plans: Plan[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialRoles?: Role[];
  searchRoleOptions?: (query: string, includeIds: string[]) => Promise<Role[]>;
  currentUserId?: string | null;
}>;
