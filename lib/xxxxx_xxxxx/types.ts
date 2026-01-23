export type XxxxxXxxxx = {
  id: string;
  name: string;
  description: string | null;
  team: string | null;
};

export type XxxxxXxxxxDetail = XxxxxXxxxx & {
  yyyyy_yyyyys: YyyyyYyyyy[];
};

export type YyyyyYyyyy = {
  id: string;
  name: string;
  type: string;
  xxxxx_xxxxx_id: string;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
  written_by: string;
};

export type XxxxxXxxxxDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    team: string | null;
    yyyyy_yyyyys: YyyyyYyyyy[];
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
}>;
