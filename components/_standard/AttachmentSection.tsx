'use client';

import { useRef, useState, useTransition } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import EditableListWrapper, { EditableListWrapperItem } from './EditableListWrapper';
import OrderedEditableListWrapper from './OrderedEditableListWrapper';
import { setAttachmentsForBridge } from '@/lib/attachment/actions';
import type { ModelPermissions } from '@/lib/authz';

const TYPE_IMAGE = 0;
const TYPE_FILE = 1;

type Attachment = {
  id: string;
  type: number;
  order: number;
  name: string;
  path: string;
};

type Props = {
  src: {
    id?: string;
    attachable_id?: string | null;
    attachable?: { id: string; attachments?: Attachment[] | null } | null;
  };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
};

type ListHandle = { getItems: () => EditableListWrapperItem[] };

function toItem(a: Attachment): EditableListWrapperItem {
  return {
    id: a.id,
    value: a.path,
    label: a.name,
    originalId: a.id,
    order: a.order,
  };
}

export default function AttachmentSection({ src, permissions }: Props) {
  const tf = useTranslations('Fields');
  const canEdit = permissions ? !!permissions.update : true;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const attachableId = src.attachable?.id ?? src.attachable_id ?? null;
  const all: Attachment[] = src.attachable?.attachments ?? [];
  const initialImages = all.filter((a) => a.type === TYPE_IMAGE).map(toItem);
  const initialFiles = all
    .filter((a) => a.type === TYPE_FILE)
    .sort((a, b) => a.order - b.order)
    .map(toItem);

  const imagesRef = useRef<ListHandle>(null);
  const filesRef = useRef<ListHandle>(null);

  if (!attachableId) {
    return (
      <Typography variant="caption" color="textSecondary" sx={{ mt: 2, display: 'block' }}>
        Save first to attach files.
      </Typography>
    );
  }

  const handleSave = () => {
    setError(null);
    const imageItems = (imagesRef.current?.getItems() ?? []).map((i) => ({
      id: typeof i.id === 'string' && !i.id.startsWith('temp-') ? i.id : i.originalId ?? null,
      name: i.label ?? '',
      path: String(i.value ?? ''),
    }));
    const fileItems = (filesRef.current?.getItems() ?? []).map((i, idx) => ({
      id: typeof i.id === 'string' && !i.id.startsWith('temp-') ? i.id : i.originalId ?? null,
      order: typeof i.order === 'number' ? i.order : idx,
      name: i.label ?? '',
      path: String(i.value ?? ''),
    }));
    startTransition(async () => {
      try {
        await setAttachmentsForBridge(attachableId, TYPE_IMAGE, imageItems);
        await setAttachmentsForBridge(attachableId, TYPE_FILE, fileItems);
        setSavedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save attachments');
      }
    });
  };

  return (
    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <EditableListWrapper
        ref={imagesRef}
        initialItems={initialImages}
        itemType="file"
        fileVariant="image"
        acceptedFileTypes="image/jpeg,image/png,image/gif,image/webp"
        addButtonLabel="Add Image"
        showTitle
        title={tf('images') ?? 'Images'}
      />
      <OrderedEditableListWrapper
        ref={filesRef}
        initialItems={initialFiles}
        itemType="file"
        fileVariant="file"
        acceptedFileTypes=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
        addButtonLabel="Add File"
        showTitle
        title={tf('attachments') ?? 'Attachments'}
      />
      {error && (
        <Typography color="error" variant="caption">
          {error}
        </Typography>
      )}
      {canEdit && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button variant="outlined" size="small" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save attachments'}
          </Button>
          {savedAt && !isPending && (
            <Typography variant="caption" color="textSecondary">
              Saved
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
