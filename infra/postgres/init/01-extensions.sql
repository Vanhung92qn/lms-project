-- Enable extensions needed from day one.
-- citext: case-insensitive email comparisons in users(email).
-- pgcrypto: gen_random_uuid() for primary keys.
-- pgvector: reserved for future RAG / embeddings work.

CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
