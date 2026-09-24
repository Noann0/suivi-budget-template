<p align="center">
  <img src="assets/readme-hero.svg" alt="Suivi Budget: a clearer view of what comes in, goes out, and stays" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Noann0/suivi-budget-template/generate"><img src="https://img.shields.io/badge/Use_this_template-b4552b?style=for-the-badge" alt="Use this template"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-536b58?style=for-the-badge" alt="MIT license"></a>
</p>

Suivi Budget is a self hosted personal finance app built with Next.js, TypeScript and SQLite. Each installation has its own local database, with two starter spaces for shared and personal spending.

## What you get

- Monthly and yearly views for income, spending and balances
- Two independent ledgers, `Joint` and `Perso`, ready to rename or replace
- Editable categories and subcategories
- CSV export for your own records
- Passkey authentication through WebAuthn
- A small SQLite database that stays with your installation
- Docker support with a persistent `/data` volume

The interface is in French. The repository includes generic starter categories and test fixtures, with no personal budget records or accounts.

## Run it locally

### Requirements

- Node.js 24 or newer
- npm
- OpenSSL, to generate the first enrollment code

### Install

```bash
git clone https://github.com/Noann0/suivi-budget-template.git
cd suivi-budget-template
npm ci
cp .env.example .env
```

Generate a private enrollment code:

```bash
openssl rand -hex 16
```

Put the generated value in `INITIAL_ENROLLMENT_CODE` in `.env`. Keep `.env` private.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000/enroll](http://localhost:3000/enroll), enter the enrollment code and register a passkey. The SQLite database is created at `data/budget.db` on first startup. Categories can be changed from Settings.

## Configuration

`.env.example` documents every supported variable. The local defaults are suitable for development:

```dotenv
DATABASE_PATH=./data/budget.db
RP_ID=localhost
ORIGIN=http://localhost:3000
RP_NAME=Suivi budget
```

For a public deployment, use a domain with HTTPS. Set `RP_ID` to the hostname only, set `ORIGIN` to the complete HTTPS URL, and generate a new `INITIAL_ENROLLMENT_CODE` of at least 24 characters. Each installation needs its own database and enrollment code.

## Docker

Build the image:

```bash
docker build -t suivi-budget .
```

For a deployment, create a private `.env.production` with `NODE_ENV=production`, `DATABASE_PATH=/data/budget.db`, your own HTTPS domain in `RP_ID` and `ORIGIN`, and a fresh enrollment code. Then run it with a persistent volume:

```bash
docker run --name suivi-budget \
  --env-file .env.production \
  -p 3000:3000 \
  -v suivi-budget-data:/data \
  suivi-budget
```

The image uses `/data/budget.db` by default. Without a persistent volume, replacing the container removes the database with it.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Keeping your data private

The application stores budget data in SQLite on the host or mounted Docker volume. Do not commit `.env`, `data/*.db`, SQLite backups, logs containing private values or exported CSV files. The repository `.gitignore` already excludes the usual local data paths, but review your own deployment and backup rules before publishing anything.

Passkeys protect access to the application. They do not encrypt a database file copied from the server, so protect the host, volume and backups as private data.

## Project layout

```text
src/app/          Next.js routes and screens
src/actions/      Server actions
src/server/       Services, repositories and rate limiting
src/db/           SQLite client, migrations and seed data
src/components/   Reusable UI components
tests/            Unit and integration tests
e2e/              End to end scenarios
```

## License

Suivi Budget is released under the [MIT License](LICENSE).
