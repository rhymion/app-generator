# Notes on demo

```
npm run demo:generate
npm run demo:start
npm run db:seed:test
npm run db:studio:test
```

シンプルな課題追跡システム用のJSONスキーマとPrismaスキーマを作成していただけますか？ITSには、Epic、Feature、User Story、Task、Bugというチケットタイプがあり、それぞれに対応するモデル/エンティティが必要で、またコメント欄も必要です。`user_account`、`role`、`permission`、`organization`は、コードジェネレーターで作成されるすべてのアプリケーションで共通となるモデル/エンティティなので、 @code_generator/json_schema_db_table.yaml と同じものにしてください。また、ユーザーが自身のアカウントを管理するために使用する`setting`エンティティも維持してください。

これはデモ目的なので、厳密な要件はありません。既存のツールを参考にしても構いません。

JSONスキーマの仕様については、@docs/knowledge/schema-yaml-configuration.md を参照してください。JSONスキーマは @code_generator/json_schema.yaml 、Prismaスキーマは @schema.prismaを書き換えてください。これら2つのスキーマは同期している必要があります。

http://localhost:3000/ にサンプルデータをいくつか入力していただけますか？ APIドキュメントは http://localhost:3000/en/docs で入手できます。API キーとして mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1 を使用できます。


Could you create JSON schema and Prisma schema for a simple issue tracking system? The ITS should have ticket types Epic, Feature, User Story, Task and Bug, each corresponding to model / entity. `user_account`, `role`, `permission` and `organization` are the models / entities that must be common for all the apps created by the code generator so please keep them the same as @json... Please also keep `setting` entity, which is used by the user to manage his/her own account.
The purpose is for demo so we don't have strict requirements. We can follow existing tools.
Please refer @schema-yaml-configuration for the spec of the JSON schema. You can rewrite @schema.prisma as I have taken backup. Those two schemas must be in sync with each other.


Could you populate a few sample data in http://localhost:3000/ 
? 
The API documents are available under http://localhost:3000/en/docs You can use mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1 as API key.


# About my-next
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Prerequisites
1. Clone the repository
   1. Create Github account if you don't
   1. Generate SSH key pair and upload the public key to your Github account
   1. Clone the repository with `git clone git@github.com:doreen-admin/my-next.git`
1. Install npm
1. Install node.js
1. Install node modules by `npm install`
1. Obtain environment information and prepare .env file
1. Create database by `npx prisma db push` if you don't use existing one
1. Generate code for database access by `npx prisma generate`

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