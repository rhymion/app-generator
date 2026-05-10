'use client';

import { GridRenderEditCellParams, useGridApiContext } from '@mui/x-data-grid';
import EntityAutocomplete, {
  EntityOption,
  EntitySearchAction,
} from './EntityAutocomplete';

/**
 * Per-column config for an entity-autocomplete cell editor.
 *
 * `labelLookup` is a *mutable* map keyed by entity id. It is shared across all
 * cells in the column so the read-mode display can resolve the label after a
 * pick. Initial entries should be seeded from the rows already on screen and
 * from initialOptions.
 */
export interface EntityAutocompleteCellConfig {
  searchAction: EntitySearchAction;
  initialOptions?: EntityOption[];
  labelLookup: Map<string, string>;
  label: string;
  required?: boolean;
}

interface EntityAutocompleteCellEditorProps extends GridRenderEditCellParams {
  config: EntityAutocompleteCellConfig;
}

export default function EntityAutocompleteCellEditor({
  id,
  field,
  value,
  config,
}: EntityAutocompleteCellEditorProps) {
  const apiRef = useGridApiContext();
  const currentId = typeof value === 'string' && value ? value : null;
  const currentLabel = currentId ? config.labelLookup.get(currentId) ?? null : null;
  const currentOption: EntityOption | null =
    currentId && currentLabel ? { id: currentId, label: currentLabel } : null;

  const handleChange = (newId: string | null, newOption: EntityOption | null) => {
    if (newId && newOption) {
      config.labelLookup.set(newId, newOption.label);
    }
    apiRef.current.setEditCellValue({ id, field, value: newId });
    // Don't try to commit here — FieldsDataGrid uses editMode="row", so the
    // surrounding row stays in edit mode until the user tabs away or saves the
    // form. The user-visible label lives on the input's `value` while editing.
  };

  return (
    <EntityAutocomplete
      sx={{ width: '100%' }}
      value={currentId}
      onChange={handleChange}
      searchAction={config.searchAction}
      initialOptions={config.initialOptions}
      currentOption={currentOption}
      label={config.label}
      required={config.required}
      openOnFocus
    />
  );
}

/** Build a `valueFormatter` that resolves the cell's id to a label via the column's lookup map. */
export function entityAutocompleteValueFormatter(
  config: EntityAutocompleteCellConfig,
): (value: unknown) => string {
  return (value) => {
    if (typeof value !== 'string' || !value) return '';
    return config.labelLookup.get(value) ?? '';
  };
}
