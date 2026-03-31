export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose prose-sm sm:prose-base dark:prose-invert max-w-4xl mx-auto py-6">
      {children}
    </article>
  );
}
