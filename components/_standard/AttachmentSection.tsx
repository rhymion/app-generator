'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { useTranslations } from 'next-intl';
import EditableListWrapper, { EditableListWrapperItem } from './EditableListWrapper';
import OrderedEditableListWrapper from './OrderedEditableListWrapper';
import { setAttachmentsForBridge } from '@/lib/attachment/actions';
import type { ModelPermissions } from '@/lib/authz';

const TYPE_IMAGE = 'image';
const TYPE_FILE = 'file';

type Attachment = {
  id: string;
  type: 'image' | 'file' | 'video' | 'audio';
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
  showImages?: boolean;
  showFiles?: boolean;
  /** Render existing attachments as a plain list with no upload/save affordances (view screens). */
  readOnly?: boolean;
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

function ReadOnlyAttachmentList({
  items,
  variant,
  title,
}: {
  items: Attachment[];
  variant: 'image' | 'file';
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items.map((a) => (
          <Box key={a.id}>
            <Link href={a.path} target="_blank" rel="noopener noreferrer">
              {a.name}
            </Link>
            {variant === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.path}
                alt={a.name}
                style={{ display: 'block', maxWidth: 80, maxHeight: 80, objectFit: 'contain', marginTop: 4 }}
              />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function AttachmentSection({
  src,
  permissions,
  showImages = true,
  showFiles = true,
  readOnly = false,
}: Props) {
  const tf = useTranslations('Fields');
  const canEdit = permissions ? !!permissions.update : true;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const attachableId = src.attachable?.id ?? src.attachable_id ?? null;
  // Memoized on the attachments array reference (not recomputed every render):
  // OrderedEditableListWrapper resyncs its internal state whenever its
  // initialItems prop is a new array, so a fresh array here on every
  // unrelated re-render (e.g. isPending flipping during handleSave) would
  // wipe out attachments the user just added but hasn't saved yet.
  const attachments = src.attachable?.attachments;
  const initialImages = useMemo(
    () => (attachments ?? []).filter((a) => a.type === TYPE_IMAGE).map(toItem),
    [attachments],
  );
  const initialFiles = useMemo(
    () => (attachments ?? [])
      .filter((a) => a.type === TYPE_FILE)
      .sort((a, b) => a.order - b.order)
      .map(toItem),
    [attachments],
  );

  const imagesRef = useRef<ListHandle>(null);
  const filesRef = useRef<ListHandle>(null);

  if (!attachableId) {
    return (
      <Typography variant="caption" color="textSecondary" sx={{ mt: 2, display: 'block' }}>
        Save first to attach files.
      </Typography>
    );
  }

  if (readOnly) {
    const images = (attachments ?? []).filter((a) => a.type === TYPE_IMAGE);
    const files = (attachments ?? [])
      .filter((a) => a.type === TYPE_FILE)
      .sort((a, b) => a.order - b.order);
    return (
      <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {showImages && <ReadOnlyAttachmentList items={images} variant="image" title={tf('images') ?? 'Images'} />}
        {showFiles && <ReadOnlyAttachmentList items={files} variant="file" title={tf('attachments') ?? 'Attachments'} />}
      </Box>
    );
  }

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        if (showImages) {
          const imageItems = (imagesRef.current?.getItems() ?? []).map((i) => ({
            id: typeof i.id === 'string' && !i.id.startsWith('temp-') ? i.id : i.originalId ?? null,
            name: i.label ?? '',
            path: String(i.value ?? ''),
          }));
          await setAttachmentsForBridge(attachableId, TYPE_IMAGE, imageItems);
        }
        if (showFiles) {
          const fileItems = (filesRef.current?.getItems() ?? []).map((i, idx) => ({
            id: typeof i.id === 'string' && !i.id.startsWith('temp-') ? i.id : i.originalId ?? null,
            order: typeof i.order === 'number' ? i.order : idx,
            name: i.label ?? '',
            path: String(i.value ?? ''),
          }));
          await setAttachmentsForBridge(attachableId, TYPE_FILE, fileItems);
        }
        setSavedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save attachments');
      }
    });
  };

  return (
    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showImages && (
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
      )}
      {showFiles && (
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
      )}
      {error && (
        <Typography color="error" variant="caption">
          {error}
        </Typography>
      )}
      {canEdit && (showImages || showFiles) && (
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
