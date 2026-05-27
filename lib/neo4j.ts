import neo4j, { type Driver } from "neo4j-driver";

import { appConfig } from "@/lib/config";

let _driver: Driver | null = null;

function driver(): Driver {
  if (!_driver) {
    _driver = neo4j.driver(
      appConfig.neo4jUri,
      neo4j.auth.basic(appConfig.neo4jUser, appConfig.neo4jPassword),
      { disableLosslessIntegers: true },
    );
  }
  return _driver;
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = driver().session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function checkNeo4jHealth(): Promise<boolean> {
  try {
    await driver().verifyConnectivity();
    return true;
  } catch {
    return false;
  }
}
