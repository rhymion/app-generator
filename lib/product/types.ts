import type { ModelPermissions } from '@/lib/authz';

export type Product = {
  id: string;
  code: string;
  name: string;
  price: number;
};

export type ProductDetail = Product & {
  images: ProductImage[];
};

export type ProductImage = {
  id: string;
  name: string;
  path: string;
};

export type ProductDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    code: string;
    name: string;
    price: number;
    images: ProductImage[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  currentUserId?: string | null;
}>;
