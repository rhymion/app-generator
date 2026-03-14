import type { ModelPermissions } from '@/lib/authz';
import type { Resource } from '@/lib/resource/types';

export type Booking = {
  id: string;
  name: string;
  resource_id: string;
  start_time: Date;
  end_time: Date;
  creator_id: string | null;
  resource?: Resource | null;
};

export type ResourceOption = {
  id: string;
  name: string;
};

export type BookingDetail = Booking;

export type BookingDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    resource_id: string;
    start_time: Date | null;
    end_time: Date | null;
    resource?: Resource | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allResources?: Resource[];
  currentUserId?: string | null;
  resourcePermissions?: ModelPermissions;
}>;
