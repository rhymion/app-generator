import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

type IconComponent = React.ComponentType<{ fontSize?: 'small' | 'medium' | 'large' | 'inherit' }>;

const ICON_MAP: Record<string, IconComponent> = {
  DeleteOutline: DeleteOutlineIcon,
  ContentCopy: ContentCopyIcon,
  ExpandMore: ExpandMoreIcon,
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
