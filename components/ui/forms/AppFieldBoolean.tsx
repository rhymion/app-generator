import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

interface AppFieldBooleanProps {
  label: React.ReactNode;
  checked: boolean;
  readOnly?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function AppFieldBoolean({ label, checked, readOnly, onChange }: AppFieldBooleanProps) {
  return (
    <FormControlLabel
      control={<Checkbox checked={checked} readOnly={readOnly} onChange={onChange} />}
      label={label}
    />
  );
}
