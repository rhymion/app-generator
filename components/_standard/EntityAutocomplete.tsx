'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';

export interface EntityOption {
  id: string;
  label: string;
}

export type EntitySearchAction = (
  query: string,
  includeIds: string[],
) => Promise<EntityOption[]>;

interface EntityAutocompleteProps {
  /** Currently selected entity id, or null for unselected. */
  value: string | null;
  onChange: (id: string | null, option: EntityOption | null) => void;
  /** Server action that returns up to N options matching the query, plus any includeIds verbatim. */
  searchAction: EntitySearchAction;
  /** Initial limited set of options shown before the user types (server-fetched on render). */
  initialOptions?: EntityOption[];
  /** Pre-resolved option for the current value. Required to render the right label on edit when the
   *  selected entity isn't in initialOptions. */
  currentOption?: EntityOption | null;
  label: string;
  required?: boolean;
  disabled?: boolean;
  sx?: object;
  /** Debounce window before firing searchAction (ms). */
  debounceMs?: number;
  /** Open the dropdown as soon as the input is focused. Defaults to false for form fields;
   *  the DataGrid cell editor sets it true so a single click after edit-mode reveals options. */
  openOnFocus?: boolean;
  analyticsFieldId?: string;
}

export default function EntityAutocomplete({
  value,
  onChange,
  searchAction,
  initialOptions = [],
  currentOption = null,
  label,
  required = false,
  disabled = false,
  sx,
  debounceMs = 250,
  openOnFocus = false,
  analyticsFieldId,
}: EntityAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [searchResults, setSearchResults] = useState<EntityOption[]>([]);
  const options = inputValue.trim() === '' ? initialOptions : searchResults;
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  // Always keep the currently-selected option present so the displayed label is correct,
  // even if it falls outside the search results.
  const mergedOptions = useMemo(() => {
    const out: EntityOption[] = [];
    const seen = new Set<string>();
    if (currentOption) {
      out.push(currentOption);
      seen.add(currentOption.id);
    }
    for (const opt of options) {
      if (!seen.has(opt.id)) {
        out.push(opt);
        seen.add(opt.id);
      }
    }
    return out;
  }, [options, currentOption]);

  const selectedOption = useMemo(() => {
    if (!value) return null;
    return mergedOptions.find((o) => o.id === value) ?? currentOption ?? null;
  }, [value, mergedOptions, currentOption]);

  useEffect(() => {
    // No search until user types — initialOptions is shown via derived `options`.
    const trimmed = inputValue.trim();
    if (trimmed === '') return;
    let cancelled = false;
    const mySeq = ++seqRef.current;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const results = await searchAction(trimmed, value ? [value] : []);
        if (!cancelled && mySeq === seqRef.current) {
          setSearchResults(results);
        }
      } catch {
        // Swallow — the component may have unmounted (e.g. form submit redirect)
        // mid-flight; surfacing this as an unhandled rejection trips React's
        // server-action error boundary and shows "An unexpected response was
        // received from the server" to the user.
      } finally {
        if (!cancelled && mySeq === seqRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inputValue, searchAction, value, debounceMs]);

  return (
    <Autocomplete
      sx={sx}
      options={mergedOptions}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      value={selectedOption}
      onChange={(_, newValue) => onChange(newValue?.id ?? null, newValue)}
      onInputChange={(_, newInput, reason) => {
        if (reason === 'input') setInputValue(newInput);
        if (reason === 'clear') setInputValue('');
      }}
      filterOptions={(x) => x}
      openOnFocus={openOnFocus}
      loading={loading}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          margin="normal"
          required={required}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
            htmlInput: {
              ...params.inputProps,
              ...(analyticsFieldId ? { 'data-analytics-field-id': analyticsFieldId } : {}),
            },
          }}
        />
      )}
    />
  );
}
