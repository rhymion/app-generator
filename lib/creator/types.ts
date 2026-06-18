import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';

export type Creator = {
  id: string;
  name: string;
  role: number;
  affiliation: number;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type CreatorDetail = Creator & {
  voiced_characters: Character[];
  composed_musics: Music[];
  credited_musics: Music[];
  credited_scenes: Scene[];
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

export type Scene = {
  id: string;
  label: string;
  work_id: string;
  episode: string;
  timestamp: string;
  work?: Work | null;
};

export type CreatorDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    role: number | null;
    affiliation: number | null;
    voiced_characters: Character[];
    composed_musics: Music[];
    credited_musics: Music[];
    credited_scenes: Scene[];
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
  initialScenes?: Scene[];
  searchSceneOptions?: (query: string, includeIds: string[]) => Promise<Scene[]>;
  currentUserId?: string | null;
}>;
