type ParamPageProps = {
  params: Promise<{ id: string }>,
  searchParams: Promise<{ key: string }>
};

// export default async function ParamPage({ params }: ParamPageProps) {
//   const { id } = await params;
//   return <p>No.{id}のページを表示しています。</p>;
// }

export default async function ParamPage({ params, searchParams }: ParamPageProps) {
  const { key } = await searchParams;
  const { id } = await params;
  return <p>No.{id}のページを表示しています。<br/>
    クエリ情報{key}を表示しています。</p>;
}
