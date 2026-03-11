import type { ModelPermissions } from '@/lib/authz';
import type { Product } from '@/lib/product/types';

export type Inventory = {
  id: string;
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  location: string | null;
  lot_number: string | null;
  expiration_date: Date | null;
  product?: Product | null;
};

export type ProductOption = {
  id: string;
  name: string;
};

export type InventoryDetail = Inventory;

export type InventoryDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    product_id: string;
    quantity: number;
    reserved_quantity: number;
    location: string | null;
    lot_number: string | null;
    expiration_date: Date | null;
    product?: Product | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allProducts?: Product[];
  currentUserId?: string | null;
  productPermissions?: ModelPermissions;
}>;
