-- Allow curated documents and automation candidates to target dynamically
-- provisioned sectors. Existing enum values are preserved as plain text.
ALTER TABLE "documents"
  ALTER COLUMN "sector" TYPE TEXT USING "sector"::TEXT;

ALTER TABLE "automation_candidates"
  ALTER COLUMN "sector" TYPE TEXT USING "sector"::TEXT;
