// Shared "add several items in one go" logic for EditableListWrapper and
// OrderedEditableListWrapper (issue #1411): the Add dialog takes any number of
// autocomplete options or files, and this turns that selection into list items.
import { attachmentUrl } from '@/lib/attachment/url';
import type { AutocompleteOption, EditableListWrapperItem, ItemType } from './EditableListWrapper';

type Validate = ((value: unknown) => string | null) | undefined;

function newItem(
  value: string | number,
  label: string,
  type: ItemType,
  uploadedId?: string,
): EditableListWrapperItem {
  return {
    id: `temp-${Date.now()}-${Math.random()}`,
    value,
    label,
    type,
    ...(uploadedId ? { originalId: uploadedId } : {}),
  };
}

/**
 * Items for the autocomplete options picked in the dialog. All-or-nothing: if any option
 * fails `validateItem`, nothing is added and the error names that option.
 */
export function itemsFromOptions(
  options: AutocompleteOption[],
  validateItem: Validate,
): { added: EditableListWrapperItem[]; error: string | null } {
  if (options.length === 0) return { added: [], error: 'Please select an option' };
  for (const o of options) {
    const err = validateItem?.(o.id);
    if (err) return { added: [], error: options.length > 1 ? `${o.label}: ${err}` : err };
  }
  return { added: options.map((o) => newItem(o.id, o.label, 'autocomplete')), error: null };
}

/** Appends newly chosen files to the selection, skipping a file that is already in it. */
export function mergeFiles(current: File[], incoming: FileList | File[] | null | undefined): File[] {
  if (!incoming) return current;
  const key = (f: File) => `${f.name}\u0000${f.size}\u0000${f.lastModified}`;
  const seen = new Set(current.map(key));
  const next = [...current];
  for (const f of Array.from(incoming)) {
    if (!seen.has(key(f))) {
      seen.add(key(f));
      next.push(f);
    }
  }
  return next;
}

/**
 * Uploads the chosen files one after another. The files that uploaded become items; the ones
 * that did not are returned in `failed` (so the dialog can keep them selected for a retry) with
 * one error line per file. Oversized files are refused up front and nothing is uploaded.
 */
export async function uploadFiles(
  files: File[],
  opts: { maxFileSize: number; uploadEndpoint: string; validateItem: Validate },
): Promise<{ added: EditableListWrapperItem[]; failed: File[]; error: string | null }> {
  if (files.length === 0) return { added: [], failed: [], error: 'Please select a file' };
  const oversized = files.filter((f) => f.size > opts.maxFileSize);
  if (oversized.length > 0) {
    const limit = `File size must be less than ${opts.maxFileSize / 1024 / 1024}MB`;
    return {
      added: [],
      failed: files,
      error: files.length > 1 ? `${oversized.map((f) => f.name).join(', ')}: ${limit}` : limit,
    };
  }

  const added: EditableListWrapperItem[] = [];
  const failed: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(opts.uploadEndpoint, { method: 'POST', body });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Upload failed');
      }
      const data = await response.json();
      const value = attachmentUrl(data.id);
      const err = opts.validateItem?.(value);
      if (err) throw new Error(err);
      added.push(newItem(value, file.name, 'file', data.id));
    } catch (e) {
      failed.push(file);
      const msg = e instanceof Error ? e.message : 'Upload failed';
      errors.push(files.length > 1 ? `${file.name}: ${msg}` : msg);
    }
  }
  return { added, failed, error: errors.length > 0 ? errors.join('\n') : null };
}
