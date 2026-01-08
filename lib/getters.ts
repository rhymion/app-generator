import prisma from '@/lib/prisma';
import type { Book, BookApi, Review } from '@/lib/types';

const API_URL = 'https://www.googleapis.com/books/v1/volumes';

export function createBook(book: BookApi): Book {
  const authors = book.volumeInfo.authors;
  const price = book.saleInfo.listPrice;
  const img = book.volumeInfo.imageLinks;
  return {
    id: book.id,
    title: book.volumeInfo.title,
    author: authors ? authors.join(',') : '',
    price: price ? price.amount : 0,
    publisher: book.volumeInfo.publisher,
    published: book.volumeInfo.publishedDate,
    image: img?.smallThumbnail ?? '/vercel.svg',
  };
}

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