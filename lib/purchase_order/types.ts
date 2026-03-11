import type { ModelPermissions } from '@/lib/authz';
import type { UserAccount } from '@/lib/user_account/types';
import type { Product } from '@/lib/product/types';

export type PurchaseOrder = {
  id: string;
  order_no: string;
  customer_id: string;
  customer?: UserAccount | null;
};

export type UserAccountOption = {
  id: string;
  name: string;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  items: PurchasePerItem[];
};

export type PurchasePerItem = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity: number;
  price: number | null;
  purchase_order?: PurchaseOrder | null;
  product?: Product | null;
};

export type PurchaseOrderDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    order_no: string;
    customer_id: string;
    customer?: UserAccount | null;
    items: PurchasePerItem[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allUserAccounts?: UserAccount[];
  allPurchaseOrders?: PurchaseOrder[];
  allProducts?: Product[];
  currentUserId?: string | null;
  userAccountPermissions?: ModelPermissions;
  purchaseOrderPermissions?: ModelPermissions;
  productPermissions?: ModelPermissions;
}>;
