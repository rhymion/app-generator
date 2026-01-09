'use server';

import prisma from '@/lib/prisma';
import type { Book, Review } from '@/lib/types';
import { createBook } from '@/lib/createBook';

const API_URL = 'https://www.googleapis.com/books/v1/volumes';

export async function getBooksByKeyword(keyword: string): Promise<Book[]> {
  const res = await fetch(`${API_URL}?q=${keyword}&langRestrict=ja&maxResults=20&printType=books`, { cache: 'no-store' });
  const result = await res.json();
  const books = [];
  for (const b of result.items) {
    books.push(createBook(b));
  }
  return books;
}

export async function getAllReviews(): Promise<Review[]> {
  return await prisma.reviews.findMany({
    orderBy: {
      read: 'desc'
    },
    // where: {
    //   OR: [
    //     { title: { contains: '入門' } },
    //     { price: { lt: 5000 } },
    //   ],
    // }
  });
}

export async function getBookById(id: string): Promise<Book> {
  const res = await fetch(`${API_URL}/${id}`, { cache: 'no-store' });
  const result = await res.json();
  return createBook(result);
}

export async function getReviewById(id: string): Promise<Review | null> {
  return await prisma.reviews.findUnique({
    where: {
      id: id
    }
  });
}