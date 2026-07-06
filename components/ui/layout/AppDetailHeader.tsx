import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { Link } from '@/i18n/navigation';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface AppDetailHeaderProps {
  title: React.ReactNode;
  editHref?: string;
  backHref: string;
}

export default function AppDetailHeader({ title, editHref, backHref }: AppDetailHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-4">
      <h1>{title}</h1>
      <div>
        {editHref && (
          <Tooltip title="Edit">
            <Link href={editHref} style={{ margin: '0 8px' }} aria-label="Edit">
              <IconButton component="span" color="primary" tabIndex={-1}>
                <EditIcon />
              </IconButton>
            </Link>
          </Tooltip>
        )}
        <Tooltip title="Back to List">
          <Link href={backHref} aria-label="Back to List">
            <IconButton component="span" tabIndex={-1}>
              <ArrowBackIcon />
            </IconButton>
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}
