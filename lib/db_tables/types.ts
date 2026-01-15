import type { ReactNode } from 'react';

export type DbTable = {
  id: string,
  name: string;
  description: string | null;
};

export type DbTableDetail = DbTable & {
  fields: Field[];
};

export type Field = {
  id: string;
  name: string;
  table_id: string;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
};

export type LayoutProps = Readonly<{
  children: ReactNode
}>;

export type DbTableDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;
