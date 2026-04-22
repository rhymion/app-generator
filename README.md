# my-next — Schema-Driven Web Application Generator

my-next is a framework that generates full-stack web applications from YAML schema files. Define your data model once, and the generator produces web screens, a database schema, a REST API, end-to-end test cases, and documentation — with login and role-based access control included by default.

## Features

- **Web screens** — List, create, edit, and view pages for every entity, including Gantt chart views
- **Database** — Prisma schema and migrations generated from your YAML definitions
- **REST API** — JSON API endpoints with API key authentication for every entity
- **E2E tests** — Cypress test suite generated alongside the application code
- **Documentation** — Knowledge articles and API specs generated from the schema
- **Authentication & access control** — Login, roles, and per-model CRUD permissions included out of the box
- **Internationalization** — English and Japanese UI with locale-aware routing
- **Dark mode** — System-aware theme switching

## Prerequisites

Install the following tools before starting. Links point to official installation instructions.

| Tool | Purpose | Minimum version |
|------|---------|----------------|
| [Git](https://git-scm.com/downloads) | Clone the repository | any |
| [Node.js](https://nodejs.org/) | Run the Next.js application | 20 LTS |
| [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) | Install JavaScript dependencies (bundled with Node.js) | 10 |
| [Python 3](https://www.python.org/downloads/) | Run the code generator | 3.10+ |
| [pip](https://pip.pypa.io/en/stable/installation/) | Install Python dependencies (bundled with Python 3.4+) | any |
| [Docker](https://docs.docker.com/get-docker/) | Run the PostgreSQL test database | any |

## Getting Started

### 1. Clone the repository

```bash
git clone git@github.com:doreen-admin/my-next.git
cd my-next
```

### 2. Install JavaScript dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Prepare environment variables

Copy the example environment file and fill in your database connection details:

```bash
# When you use test environment
cp .env.test .env
```

### 5. Start the database

```bash
npm run docker:test:up
```

### 6. Apply the schema and generate the Prisma client

```bash
npx prisma db push
npx prisma generate
```

### 7. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Generating an Application from a Schema

Edit `code_generator/json_schema.yaml` and `prisma/schema.prisma` to define your entities, then run:

```bash
npm run generate-code
```

You can also update the schema files using sample application by running:

```bash
cp -a custom/sample/* .
npm run generate-code
```

This overwrites the generated TypeScript files, React components, and API routes. After generation, push the updated schema to the database:

```bash
npx prisma db push
npx prisma generate
```

See [docs/knowledge/schema-yaml-configuration.md](docs/knowledge/schema-yaml-configuration.md) for the full schema reference.

## Running Tests

```bash
# Unit and integration tests
npm run test

# Code generator tests
pytest code_generator/tests

# Full CI gate (generator -> database -> build -> tests)
npm run docker:test:up
npm run demo:generate
npm run test
npm run build
```

E2E tests (Cypress) are run separately from a terminal due to sandboxed environment limitations:

```bash
npm run cy:test
```

## Project Structure

```
code_generator/    Python generator -- reads YAML, writes TypeScript/React/Cypress
docs/knowledge/    Architecture guides and configuration reference
app/               Next.js App Router pages (generated + hand-written)
components/        React components (generated + extension points)
lib/               Server-side service and getter modules (generated + extension points)
prisma/            Database schema and migrations
cypress/           E2E test suite (generated + custom specs)
messages/          i18n translation files (en, ja)
```
