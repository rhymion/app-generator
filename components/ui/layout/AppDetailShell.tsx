interface AppDetailShellProps {
  children?: React.ReactNode;
}

export default function AppDetailShell({ children }: AppDetailShellProps) {
  return <div>{children}</div>;
}
