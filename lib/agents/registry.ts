import type { Sector } from "@/lib/domain";

import { runSectorAgent } from "@/lib/agents/base-agent";
import { AGENT_PERSONAS } from "@/lib/agents/personas";

export function getAgentPersona(sector: Sector) {
  return AGENT_PERSONAS[sector];
}

export const agentRegistry = {
  run: runSectorAgent,
};
