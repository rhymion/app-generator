type ParamAllPageProps = {
  params: Promise<{ keywords?: string[] }>
};

export default async function ParamAllPage({ params }: ParamAllPageProps) {
  const { keywords } = await params;
  return keywords ?
    <p>Keywords passed: {keywords.join()}</p> :
    <p>No keywords.</p>;
}