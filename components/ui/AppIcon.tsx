import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

type IconComponent = React.ComponentType<{ fontSize?: 'small' | 'medium' | 'large' | 'inherit' }>;

const ICON_MAP: Record<string, IconComponent> = {
  DeleteOutline: DeleteOutlineIcon,
  ContentCopy: ContentCopyIcon,
  ExpandMore: ExpandMoreIcon,
  Add: AddIcon,
  Delete: DeleteIcon,
};

interface AppIconProps {
  name: string;
  fontSize?: 'small' | 'medium' | 'large' | 'inherit';
}

export default function AppIcon({ name, fontSize }: AppIconProps) {
  const IconComp = ICON_MAP[name];
  if (!IconComp) return null;
  return <IconComp fontSize={fontSize} />;
}
