#!/bin/bash
# Switch to SQLite for local experimentation

set -e

echo "Switching to SQLite..."

# Backup current schema
cp prisma/schema.prisma prisma/schema.postgres.backup

# Use SQLite schema
cp prisma/schema.sqlite.prisma prisma/schema.prisma

# Set DATABASE_URL to SQLite
export DATABASE_URL="file:./dev.db"

# Generate Prisma client
echo "Generating Prisma client for SQLite..."
npx prisma generate

# Push schema to SQLite
echo "Pushing schema to SQLite database..."
npx prisma db push

echo "Switched to SQLite successfully!"
echo "DATABASE_URL is now: file:./dev.db"
echo "To switch back to PostgreSQL, run: ./scripts/use-postgres.sh"
