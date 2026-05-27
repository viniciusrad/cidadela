-- AlterTable: agent_calls - change from_agent and to_agent from Sector enum to TEXT
ALTER TABLE "agent_calls"
  ALTER COLUMN "from_agent" TYPE TEXT USING "from_agent"::TEXT,
  ALTER COLUMN "to_agent" TYPE TEXT USING "to_agent"::TEXT;

-- AlterTable: protocols - change from_sector and to_sector from Sector enum to TEXT
ALTER TABLE "protocols"
  ALTER COLUMN "from_sector" TYPE TEXT USING "from_sector"::TEXT,
  ALTER COLUMN "to_sector" TYPE TEXT USING "to_sector"::TEXT;
