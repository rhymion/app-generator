'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EntityAutocomplete from '@/components/_standard/EntityAutocomplete';
import { upsertPermission, removePermission } from '@/lib/permission/actions';
import type { FormUpsertProps } from '@/lib/permission/types';
import FormWithChildGrid from '@/components/_standard/FormWithChildGrid';
import AuditInfo from '@/components/_standard/AuditInfo';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import { validateForm } from './form_validation';

export default function FormUpsert({ src, isEdit, permissions, initialRoles = [], searchRoleOptions }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tf = useTranslations('Fields');
  const te = useTranslations('EntityLabel');
  const tc = useTranslations('Common');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);

  const [create, setCreate] = useState<boolean>(Boolean(src.create));
  const [read, setRead] = useState<boolean>(Boolean(src.read));
  const [update, setUpdate] = useState<boolean>(Boolean(src.update));
  const [deleteValue, setDeleteValue] = useState<boolean>(Boolean(src.delete));
  const [roleId, setRoleId] = useState<string | null>(src.role_id || null);
  const [name, setName] = useState<string | null>(src.name || null);
  const nameOptions = [{ value: 'user', label: 'User' }, { value: 'setting', label: 'Setting' }, { value: 'role', label: 'Role' }, { value: 'organization', label: 'Organization' }, { value: 'permission', label: 'Permission' }, { value: 'approval_flow', label: 'Approval Flow' }];
  const roleIdInitialOptions = useMemo(() => (initialRoles ?? []).map((item) => ({
    id: item.id,
    label: (item.name ?? ''),
  })), [initialRoles]);
  const roleIdSearchAction = useCallback(async (query: string, includeIds: string[]) => {
    const rows = (await searchRoleOptions?.(query, includeIds)) ?? [];
    return rows.map((item) => ({ id: item.id, label: (item.name ?? '') }));
  }, [searchRoleOptions]);
  const roleIdCurrentOption = useMemo(() => (
    src.role ? { id: src.role.id, label: (src.role?.name ?? '') } : null
  ), [src.role]);
  const getValidationError = () => validateForm({
    isEdit,
    id: src.id,
    role_id: roleId,
    create: create,
    read: read,
    update: update,
    delete: deleteValue,
    name: name,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;
    const validationMessage = getValidationError();
    setValidationError(validationMessage);
    if (validationMessage) {
      return;
    }

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
    formData.set('name', name || '');
    formData.set('role_id', roleId || '');
    formData.set('create', create.toString());
    formData.set('read', read.toString());
    formData.set('update', update.toString());
    formData.set('delete', deleteValue.toString());

    try {
      startTransition(async () => {
        await upsertPermission(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    await removePermission([src.id]);
  };

  const handleBack = () => {
    router.push('/permission');
  };

  const formFields = (
    <>
      <Autocomplete
        options={nameOptions}
        value={nameOptions.find((o) => o.value === name) ?? null}
        onChange={(_, newValue) => setName(newValue?.value ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={tf('name')}
            margin="normal"
            required
          />
        )}
      />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <EntityAutocomplete
          sx={{ flex: 1 }}
          value={roleId}
          onChange={(id) => setRoleId(id)}
          searchAction={roleIdSearchAction}
          initialOptions={roleIdInitialOptions}
          currentOption={roleIdCurrentOption}
          label={tf('role')}
          required={false}
        />
        {roleId && (
          <Tooltip title="View">
            <Link href={`/role/view/${roleId}`} aria-label="View Role">
              <IconButton component="span" size="small" tabIndex={-1} sx={{ mt: 2 }}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Link>
          </Tooltip>
        )}
      </Box>
      <FormControlLabel
        control={<Checkbox checked={create} onChange={(e) => setCreate(e.target.checked)} />}
        label={tf('create')}
      />
      <FormControlLabel
        control={<Checkbox checked={read} onChange={(e) => setRead(e.target.checked)} />}
        label={tf('read')}
      />
      <FormControlLabel
        control={<Checkbox checked={update} onChange={(e) => setUpdate(e.target.checked)} />}
        label={tf('update')}
      />
      <FormControlLabel
        control={<Checkbox checked={deleteValue} onChange={(e) => setDeleteValue(e.target.checked)} />}
        label={tf('delete')}
      />
      {validationError && <p style={{ color: 'red' }}>{validationError}</p>}
      {isEdit && <AuditInfo src={src} />}
    </>
  );

  return (
    <>
      <FormWithChildGrid
        title={isEdit ? tc('editEntity', { entity: te('permission') }) : tc('addEntity', { entity: te('permission') })}
        isEdit={isEdit}
        formFields={formFields}
        onSubmit={handleSubmit}
        onDelete={isEdit && canDelete ? handleDelete : undefined}
        onBack={handleBack}
        deleteEntityLabel={te('permission')}
        submitButtonLabel={tc('save')}
        error={error}
      />
    </>
  );
}
