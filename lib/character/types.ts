import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';

export type Character = {
  id: string;
  name: string;
  work_id: string;
  official_image: boolean;
  creator_id: string | null;
  work?: Work | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type WorkOption = {
  id: string;
  label: string;
};

export type CharacterDetail = Character & {
  scenes: Scene[];
  creators: Creator[];
};

export type Scene = {
  id: string;
  label: string;
  work_id: string;
  episode: string;
  timestamp: string;
  work?: Work | null;
};

export type Creator = {
  id: string;
  name: string;
  role: number;
  affiliation: number;
};

export type CharacterDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    work_id: string;
    official_image: boolean;
    work?: Work | null;
    scenes: Scene[];
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
  initialScenes?: Scene[];
  searchSceneOptions?: (query: string, includeIds: string[]) => Promise<Scene[]>;
  initialCreators?: Creator[];
  searchCreatorOptions?: (query: string, includeIds: string[]) => Promise<Creator[]>;
  initialWorks?: Work[];
  searchWorkOptions?: (query: string, includeIds: string[]) => Promise<Work[]>;
  currentUserId?: string | null;
}>;
