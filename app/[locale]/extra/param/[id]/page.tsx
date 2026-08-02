type ParamPageProps = {
  params: Promise<{ id: string }>,
  searchParams: Promise<{ key: string }>
};

// export default async function ParamPage({ params }: ParamPageProps) {
//   const { id } = await params;
//   return <p>Showing page No.{id}.</p>;
// }

export default async function ParamPage({ params, searchParams }: ParamPageProps) {
  const { key } = await searchParams;
  const { id } = await params;
  return <p>Showing page No.{id}.<br/>
    Showing query info {key}.</p>;
}
