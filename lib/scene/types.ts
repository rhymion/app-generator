import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';

export type Scene = {
  id: string;
  label: string;
  work_id: string;
  episode: string;
  timestamp: string;
  creator_id: string | null;
  work?: Work | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type WorkOption = {
  id: string;
  label: string;
};

export type SceneDetail = Scene & {
  characters: Character[];
  music: Music[];
  creators: Creator[];
};

export type Character = {
  id: string;
  name: string;
  work_id: string;
  official_image: boolean;
  work?: Work | null;
};

export type Music = {
  id: string;
  title: string;
  kind: number;
};

export type Creator = {
  id: string;
  name: string;
  role: number;
  affiliation: number;
};

export type SceneDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    label: string;
    work_id: string;
    episode: string;
    timestamp: string;
    work?: Work | null;
    characters: Character[];
    music: Music[];
    creators: Creator[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialCharacters?: Character[];
  searchCharacterOptions?: (query: string, includeIds: string[]) => Promise<Character[]>;
  initialMusics?: Music[];
  searchMusicOptions?: (query: string, includeIds: string[]) => Promise<Music[]>;
  initialCreators?: Creator[];
  searchCreatorOptions?: (query: string, includeIds: string[]) => Promise<Creator[]>;
  initialWorks?: Work[];
  searchWorkOptions?: (query: string, includeIds: string[]) => Promise<Work[]>;
  currentUserId?: string | null;
}>;
