import { getTranslations } from 'next-intl/server';

export default async function Home() {
  const t = await getTranslations('Home');
  return (<h2 className='text-3xl font-bold my-8'>{t('welcome')}</h2>);
}
