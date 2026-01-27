export type Parent1 = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  due_date: Date;
  image_url: string | null;
};

export type Parent1Detail = Parent1 & {
  parent1_child1s: Parent1Child1[];
  parent1_child2s: Parent1Child2[];
};

export type Parent1Child1 = {
  id: string;
  name: string;
  type: string;
  parent1_id: string;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
  written_by: string;
};

export type Parent1Child2 = {
  id: string;
  name: string;
  required: boolean;
  start_date: Date | null;
  end_date: Date;
};
export type Parent1DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    due_date: Date;
    image_url: string | null;
    parent1_child1s: Parent1Child1[];
    parent1_child2s: Parent1Child2[];
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
}>;
