'use client';

import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ClearIcon from '@mui/icons-material/Clear';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import EntityAutocomplete, { type EntityOption, type EntitySearchAction } from '@/components/_standard/EntityAutocomplete';

interface AppFieldRelationBaseProps {
  label: string;
  href?: string | null;
}

interface AppFieldRelationReadOnlyProps extends AppFieldRelationBaseProps {
  readOnly: true;
  value: string;
  onChange?: never;
  searchAction?: never;
  initialOptions?: never;
  currentOption?: never;
  required?: never;
  permissionDenied?: never;
}

interface AppFieldRelationEditProps extends AppFieldRelationBaseProps {
  readOnly?: false;
  value: string | null;
  onChange: (id: string | null) => void;
  searchAction: EntitySearchAction;
  initialOptions?: EntityOption[];
  currentOption?: EntityOption | null;
  required?: boolean;
  /**
   * Set when the current user lacks read permission on this FK's target
   * entity (cmd_516 Option B). No candidates can be searched or selected —
   * the field renders as a restricted display of the current value instead
   * of an EntityAutocomplete. A non-required field can still be cleared; a
   * required field is locked to its existing value (clearing it would leave
   * a required FK empty with no way to pick a replacement).
   */
  permissionDenied?: boolean;
}

type AppFieldRelationProps = AppFieldRelationReadOnlyProps | AppFieldRelationEditProps;

export default function AppFieldRelation(props: AppFieldRelationProps) {
  const tc = useTranslations('Common');
  const te = useTranslations('Errors');

  if (props.readOnly) {
    const { label, href, value } = props;
    return (
      <TextField
        label={label}
        value={value ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
        slotProps={{ input: { endAdornment: href ? (
          <InputAdornment position="end">
            <Tooltip title="View">
              <Link href={href} aria-label="View">
                <IconButton component="span" size="small" tabIndex={-1}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Link>
            </Tooltip>
          </InputAdornment>
        ) : null } }}
      />
    );
  }

  const { label, href, value, onChange, searchAction, initialOptions, currentOption, required, permissionDenied } = props;

  if (permissionDenied) {
    const canClear = !required && !!value;
    return (
      <TextField
        label={label}
        value={currentOption?.label ?? ''}
        fullWidth
        margin="normal"
        required={required}
        aria-readonly
        helperText={`${te('fkPermissionDenied', { entity: label })} ${te('fkPermissionDeniedHint', { entity: label })}`}
        slotProps={{ input: { readOnly: true, endAdornment: (
          <InputAdornment position="end">
            {canClear && (
              <Tooltip title={tc('cancel')}>
                <span>
                  <IconButton aria-label="clear" size="small" onClick={() => onChange(null)}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {href && (
              <Tooltip title="View">
                <Link href={href} aria-label="View">
                  <IconButton component="span" size="small" tabIndex={-1}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Link>
              </Tooltip>
            )}
          </InputAdornment>
        ) } }}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <EntityAutocomplete
        sx={{ flex: 1 }}
        value={value}
        onChange={(id) => onChange(id)}
        searchAction={searchAction}
        initialOptions={initialOptions}
        currentOption={currentOption}
        label={label}
        required={required}
      />
      {href && (
        <Tooltip title="View">
          <Link href={href} aria-label="View">
            <IconButton component="span" size="small" tabIndex={-1} sx={{ mt: 2 }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Link>
        </Tooltip>
      )}
    </Box>
  );
}
