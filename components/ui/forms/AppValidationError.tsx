interface AppValidationErrorProps {
  message: string | null;
}

export default function AppValidationError({ message }: AppValidationErrorProps) {
  if (!message) return null;
  return <p style={{ color: 'red' }}>{message}</p>;
}
