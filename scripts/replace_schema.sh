#!/bin/bash
echo "$PRISMA_SCHEMA" > ./prisma/schema.prisma
echo "$JSON_SCHEMA" > ./code_generator/json_schema.yaml