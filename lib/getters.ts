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
  const reviewsData = await prisma.reviews.findMany({
    include: {
      book: true,
      author: true,
    },
    orderBy: {
      read: 'desc'
    },
  });

  return reviewsData.map((review) => ({
    id: review.id,
    title: review.book.title,
    author: review.book.author,
    price: review.book.price,
    publisher: review.book.publisher,
    published: review.book.published,
    image: review.book.image,
    read: review.read,
    memo: review.memo,
    bookId: review.book.id,
  }));
}

export async function getBookById(id: string): Promise<Book> {
  const res = await fetch(`${API_URL}/${id}`, { cache: 'no-store' });
  const result = await res.json();
  return createBook(result);
}

export async function getReviewById(id: string): Promise<Review | null> {
  const review = await prisma.reviews.findUnique({
    where: {
      id: id
    },
    include: {
      book: true,
    },
  });

  if (!review) return null;

  return {
    id: review.id,
    title: review.book.title,
    author: review.book.author,
    price: review.book.price,
    publisher: review.book.publisher,
    published: review.book.published,
    image: review.book.image,
    read: review.read,
    memo: review.memo,
    bookId: review.book.id,
  };
}