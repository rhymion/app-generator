import type { ModelPermissions } from '@/lib/authz';
import type { Work } from '@/lib/work/types';

export type Music = {
  id: string;
  title: string;
  kind: number;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type MusicDetail = Music & {
  scenes: Scene[];
  composers: Creator[];
  credits: Creator[];
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

export type MusicDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    title: string;
    kind: number | null;
    scenes: Scene[];
    composers: Creator[];
    credits: Creator[];
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
  currentUserId?: string | null;
}>;
