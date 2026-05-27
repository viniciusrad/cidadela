import {
  collectPilotSnapshotData,
  parseDateBoundary,
  parsePilotUserEmails,
  parseSnapshotDate,
  renderPilotSnapshotMarkdown,
  startOfLocalDay,
  writePilotSnapshot,
  type PilotSnapshotConfig,
} from "../lib/pilot/snapshot";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

function argValue(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return process.env[`npm_config_${name.replace(/-/g, "_")}`];
}

function hasFlag(name: string) {
  return (
    process.argv.includes(`--${name}`) ||
    process.env[`npm_config_${name.replace(/-/g, "_")}`] === "true"
  );
}

function buildConfig(): PilotSnapshotConfig {
  const now = new Date();
  const snapshotDate = parseSnapshotDate(argValue("date"), now);
  const windowStart = parseDateBoundary(
    argValue("start") ?? process.env.PILOT_START_DATE,
    startOfLocalDay(now),
  );
  const windowEnd = parseDateBoundary(argValue("end"), now);
  const pilotUserEmails = parsePilotUserEmails(
    argValue("users") ?? process.env.PILOT_USER_EMAILS,
  );

  if (windowEnd.getTime() < windowStart.getTime()) {
    throw new Error("A data final do snapshot nao pode ser anterior ao inicio.");
  }

  return {
    pilotUserEmails,
    pilotSector: argValue("sector") ?? process.env.PILOT_SECTOR,
    sponsor: argValue("sponsor") ?? process.env.PILOT_SPONSOR,
    champion: argValue("champion") ?? process.env.PILOT_CHAMPION,
    snapshotDate,
    windowStart,
    windowEnd,
    standupNotes: argValue("notes") ?? process.env.PILOT_STANDUP_NOTES,
  };
}

async function main() {
  const config = buildConfig();
  const data = await collectPilotSnapshotData(config);

  if (hasFlag("dry-run")) {
    process.stdout.write(renderPilotSnapshotMarkdown(data));
    return;
  }

  const outputPath = await writePilotSnapshot(data);
  console.log(`Snapshot do piloto gravado em ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
