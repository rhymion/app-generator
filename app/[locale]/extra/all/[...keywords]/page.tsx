type ParamAllPageProps = {
  params: Promise<{ keywords: string[] }>
};

export default async function ParamAllPage({ params }: ParamAllPageProps) {
  const { keywords } = await params;
  return <p>Keywords passed: {keywords.join()}</p>;
}