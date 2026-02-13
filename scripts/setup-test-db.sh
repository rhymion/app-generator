#!/bin/bash
# Setup test database for e2e testing

set -e

echo "Setting up test database..."

# Load test environment variables
export $(cat .env.test | grep -v '^#' | xargs)

# Drop and recreate test database (PostgreSQL)
echo "Resetting test database..."
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS my_next_test;" || true
psql -h localhost -U postgres -c "CREATE DATABASE my_next_test;"

# Run migrations
echo "Running Prisma migrations..."
npx prisma migrate deploy

# Optional: Seed test data
# npx prisma db seed

echo "Test database setup complete!"
