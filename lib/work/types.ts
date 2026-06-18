import type { ModelPermissions } from '@/lib/authz';

export type Work = {
  id: string;
  title: string;
  pattern: number;
  status: number;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type WorkDetail = Work & {
  characters: Character[];
  scenes: Scene[];
};

export type Character = {
  id: string;
  name: string;
  work_id: string;
  official_image: boolean;
  work?: Work | null;
};

export type Scene = {
  id: string;
  label: string;
  work_id: string;
  episode: string;
  timestamp: string;
  work?: Work | null;
};

export type WorkDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    title: string;
    pattern: number | null;
    status: number | null;
    characters: Character[];
    scenes: Scene[];
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
  initialScenes?: Scene[];
  searchSceneOptions?: (query: string, includeIds: string[]) => Promise<Scene[]>;
  currentUserId?: string | null;
}>;
