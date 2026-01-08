import type { ReactNode } from 'react';

export type BookApi = {
  id: string,
  volumeInfo: {
    title: string;
    authors: string[];
    publisher: string;
    publishedDate: string;
    imageLinks: {
      smallThumbnail: string | null;
    };
  },
  saleInfo: {
    listPrice: {
      amount: number;
    };
  };
};

export type Review = Book & {
  read: Date;
  memo: string;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  price: number;
  publisher: string;
  published: string;
  image: string;
};

export type LayoutProps = Readonly<{
  children: ReactNode
}>;

export type BookResultProps = Readonly<{
  params: Promise<{
    keyword?: string[];
  }>
}>;

export type EditPageProps =  Readonly<{
  params: Promise<{
    id: string;
  }>,
  searchParams: Promise<{
    key?: string;
  }>
}>;

export type FormEditProps = Readonly<{
  src: {
    id: string;
    read: string;
    memo?: string;
  }
}>;

export type BookDetailsProps = Readonly<{
  index?: number;
  book: Book;
}>;