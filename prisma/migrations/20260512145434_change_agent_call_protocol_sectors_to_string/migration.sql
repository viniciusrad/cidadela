-- The ALTER COLUMN changes (enum -> TEXT) were applied by migration 20260512115447.
-- This migration only ensures the unique index on protocols exists.
CREATE UNIQUE INDEX IF NOT EXISTS "protocols_from_sector_to_sector_intent_key"
  ON "protocols"("from_sector", "to_sector", "intent");
