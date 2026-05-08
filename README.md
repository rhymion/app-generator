# Rhymion Web Application Generator — Schema-Driven Web Application Generator

Generate production-ready web applications from schema definitions. Define your data structures and screens in YAML — the generator produces a complete Next.js application with CRUD operations, role-based access control, REST API, and multilingual support.

Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), and [MUI](https://mui.com/).

---

## What This Is

This application is a schema-driven code generator. You describe your application's data model and screen layout in a YAML configuration file, and the generator produces a working web application that you own and can extend freely.

The generated application is yours — you can deploy it, sell it, modify it, and build your own business logic on top of it.

---

## Features

- **Web screens** — List, create, edit, delete, and view pages for every entity, including Gantt chart views
- **Database** — Prisma schema and migrations generated from your YAML definitions
- **Table relationships** — Including one-to-many, many-to-many and self-relations
- **REST API** — JSON API endpoints with API key authentication for every entity
- **E2E tests** — Cypress test suite generated alongside the application code
- **Documentation** — Knowledge articles and API specs generated from the schema
- **Authentication & access control** — Login, roles, and per-model CRUD permissions included out of the box
- **Internationalization** — English and Japanese UI with locale-aware routing
- **Dark mode** — System-aware theme switching

---

## Current Status

This generator is suitable for internal business applications and moderate-scale deployments. **Support for large datasets and high-traffic production environments is planned but not yet available.** Performance improvements are under active development.

Planned features include:
- Search beyond column filtering
- Two-factor authentication and SSO
- Data aggregation and visualization
- Performance improvements for large datasets

---

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
git clone git@github.com:rhymion/app-generator.git
cd app-generator
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

---

## License

This project is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

### What you can do

✅ Use the generator freely for any purpose  
✅ Generate applications and sell them to your clients or as your own product  
✅ Modify the generator source code  
✅ Distribute modified versions of the generator, **as long as the modified source is publicly available** (see below)

### What you cannot do

❌ Operate a commercial service that lets third parties define schemas and generate applications using this software — for example, a hosted no-code or low-code platform built on this generator

### Sharing modifications

If you distribute a modified version of this generator, the modifications must be made publicly accessible in one of the following ways:

- Submit a pull request or patch to the [official repository](https://github.com/rhymion/app-generator)
- Maintain a publicly accessible fork on GitHub or an equivalent public code hosting service

You may not distribute a modified version with the source kept private.

### Becoming MIT

On the fourth anniversary of the first public release of this version, the license automatically converts to the **MIT License**. At that point, all restrictions are lifted.

### Commercial license

If you need to use this software in a way not permitted by the BUSL-1.1 — for example, incorporating it into a proprietary closed-source product — please contact us at [contact@rhymion.com](mailto:contact@rhymion.com).

See [LICENSE](./LICENSE) for the full license text.

---

## Contributing

Contributions are welcome. By submitting a pull request, you agree that your contribution will be licensed under the same terms as this project.

Please open an issue before beginning significant work to discuss the approach.

---

## About

This application is developed by [Rhymion Labs](https://rhymion.com), founded in 2026.

Our focus is helping organizations build the internal tooling they need without diverting engineering resources from their core business.

- Website: [rhymion.com](https://rhymion.com)
- GitHub: [github.com/rhymion](https://github.com/rhymion)
- LinkedIn: [linkedin.com/company/rhymion](https://linkedin.com/company/rhymion)
- Contact: [contact@rhymion.com](mailto:contact@rhymion.com)
