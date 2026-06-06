'use client';

import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Box from '@mui/material/Box';
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
}

interface AppFieldRelationEditProps extends AppFieldRelationBaseProps {
  readOnly?: false;
  value: string | null;
  onChange: (id: string | null) => void;
  searchAction: EntitySearchAction;
  initialOptions?: EntityOption[];
  currentOption?: EntityOption | null;
  required?: boolean;
}

type AppFieldRelationProps = AppFieldRelationReadOnlyProps | AppFieldRelationEditProps;

export default function AppFieldRelation(props: AppFieldRelationProps) {
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

  const { label, href, value, onChange, searchAction, initialOptions, currentOption, required } = props;
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
