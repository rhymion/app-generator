import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Typography from '@mui/material/Typography';

interface AppSectionProps {
  label: React.ReactNode;
  children?: React.ReactNode;
  mt?: number;
}

export default function AppSection({ label, children, mt }: AppSectionProps) {
  return (
    <Accordion sx={mt !== undefined ? { mt } : undefined}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography>{label}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}
