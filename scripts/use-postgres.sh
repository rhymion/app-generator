#!/bin/bash
# Switch back to PostgreSQL

set -e

echo "Switching to PostgreSQL..."

# Restore PostgreSQL schema if backup exists
if [ -f prisma/schema.postgres.backup ]; then
  cp prisma/schema.postgres.backup prisma/schema.prisma
  rm prisma/schema.postgres.backup
fi

# Generate Prisma client
echo "Generating Prisma client for PostgreSQL..."
npx prisma generate

echo "Switched to PostgreSQL successfully!"
echo "Make sure your DATABASE_URL in .env points to PostgreSQL"
