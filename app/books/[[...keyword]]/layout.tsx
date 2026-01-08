'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef } from 'react';
import type { LayoutProps } from '@/lib/types';

export default function BooksLayout({ children }: LayoutProps) {
  const router = useRouter();
  const txtKeyword = useRef<HTMLInputElement>(null);
  const handleSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push(`/books/${encodeURIComponent(txtKeyword.current!.value)}`);
  };

  return (
    <>
    <form className="mt-2 mb-4" onSubmit={handleSearch}>
      <input type="text" ref={txtKeyword}
 className="bg-gray-100 text-black border border-gray-600 rounded mr-2 px-2
py-2 focus:bg-white focus:outline-none focus:border-red-500" />
      <button type="submit"
        className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-500">
        検索</button>
    </form>
    <hr />
    {children}
    </>
  );
}