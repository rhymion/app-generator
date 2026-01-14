'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getBookById } from '@/lib/getters';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function addReview(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const bookId = data.get('id') as string;
  const book = await getBookById(bookId);
  const read = new Date(data.get('read') as string);
  const memo = data.get('memo') as string;

  // Create or update the book
  await prisma.books.upsert({
    where: { id: bookId },
    update: {
      title: book.title,
      author: book.author,
      price: Number(book.price),
      publisher: book.publisher,
      published: book.published,
      image: book.image || '',
    },
    create: {
      id: bookId,
      title: book.title,
      author: book.author,
      price: Number(book.price),
      publisher: book.publisher,
      published: book.published,
      image: book.image || '',
    },
  });

  // Create or update the review
  await prisma.reviews.upsert({
    where: {
      id: `${bookId}-${session.user.id}`,
    },
    update: {
      read,
      memo,
    },
    create: {
      id: `${bookId}-${session.user.id}`,
      book_id: bookId,
      author_id: session.user.id,
      read,
      memo,
    },
  });

  revalidatePath('/');
  redirect('/');
}

export async function removeReview(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const bookId = data.get('id') as string;
  await prisma.reviews.delete({
    where: {
      id: `${bookId}-${session.user.id}`,
    },
  });
  revalidatePath('/');
  redirect('/');
}

// イベントハンドラーからサーバーアクションを呼び出す場合
// export async function removeReview(data: string) {
//   await prisma.reviews.delete({
//     where: {
//       id: data
//     }
//   });
//   revalidatePath('/');
//   redirect('/');
// }