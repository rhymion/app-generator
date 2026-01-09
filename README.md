This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Differences from tutorial

* URL setting should not be in schema.prisma. It should only be in prisma.config.ts
* npx prisma db push does not create files in app/generated/prisma. Successfully created with `npm install @prisma/client` and `npx prisma generate`
* prisma.ts has an error in using PrismaClient. ~~The constructor requires `accelerateUrl` as well as `log`. Unlike the [sample code](https://www.prisma.io/docs/guides/supabase-accelerate#6-send-queries-through-the-connection-pool), DATABASE_URL must be typed with `as string` to avoid error.~~ A driver adapeter is needed to use PrismaClient with sqlite (see the [official doc](https://www.prisma.io/docs/orm/overview/databases/sqlite#2-instantiate-prisma-client-using-the-driver-adapter)) after installing PrismaBetterSqlite3 with `npm install @prisma/adapter-better-sqlite3`.
* When we switch the database from sqlite to postgresql, in addition to follow the instruction in the tutorial, we will have to
   * define `PRISMA_DATABASE_URL` displayed in Vercel in .env file, with the value starting with `prisma+postgres://`.
   * run `npm install @prisma/extension-accelerate` to install the library
   * set `PRISMA_DATABASE_URL` to `accelerateUrl` in prisma.ts (unlike in the [official doc](https://www.prisma.io/docs/accelerate/getting-started#24-extend-your-prisma-client-instance-with-the-accelerate-extension), the parameter is not `DATABASE_URL`. And it is necessary to type the parameter with `as string` to avoid error.)
   * run `npx prisma generate` to generate code for postgresql
* `experimental.cacheComponents` has been moved to `cacheComponents`. So we updated next.config.ts file accordingly.