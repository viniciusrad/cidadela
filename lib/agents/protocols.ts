import type { Sector } from "@/lib/domain";

export type ProtocolDefinition = {
  from: Sector;
  to: Sector;
  intent: string;
  id: string;
  template: string;
  maxTokens: number;
  enabled: boolean;
};

export const PROTOCOLS: ProtocolDefinition[] = [
  {
    from: "desenvolvimento",
    to: "seguranca",
    intent: "politica-seguranca",
    id: "desenvolvimento->seguranca:politica-seguranca:v1",
    template:
      "Responda ao agente de Desenvolvimento apenas com a perspectiva de Seguranca/Infra. Priorize politica, controle, credenciais, autenticacao e risco.",
    maxTokens: 480,
    enabled: true,
  },
  {
    from: "desenvolvimento",
    to: "suporte",
    intent: "impacto-operacional",
    id: "desenvolvimento->suporte:impacto-operacional:v1",
    template:
      "Responda ao agente de Desenvolvimento com foco no impacto operacional ao usuario, sinais de incidente e orientacao de atendimento.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "desenvolvimento",
    to: "desktop",
    intent: "hardware-e-estacoes",
    id: "desenvolvimento->desktop:hardware-e-estacoes:v1",
    template:
      "Responda ao agente de Desenvolvimento com foco em hardware, perifericos, estacoes de trabalho e softwares locais.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "suporte",
    to: "desenvolvimento",
    intent: "escalonamento-tecnico",
    id: "suporte->desenvolvimento:escalonamento-tecnico:v1",
    template:
      "Responda ao agente de Suporte com foco em causa tecnica, API, deploy, integracao e passo corretivo de engenharia.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "suporte",
    to: "seguranca",
    intent: "incidente-seguranca",
    id: "suporte->seguranca:incidente-seguranca:v1",
    template:
      "Responda ao agente de Suporte com orientacoes para classificacao, contencao e politica de incidente de seguranca.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "seguranca",
    to: "desenvolvimento",
    intent: "implementacao-tecnica",
    id: "seguranca->desenvolvimento:implementacao-tecnica:v1",
    template:
      "Responda ao agente de Seguranca explicando a abordagem tecnica de implementacao, integracao e controles aplicaveis no codigo ou na API.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "seguranca",
    to: "suporte",
    intent: "triagem-atendimento",
    id: "seguranca->suporte:triagem-atendimento:v1",
    template:
      "Responda ao agente de Seguranca com orientacoes de atendimento, triagem operacional, SLA e impacto ao usuario.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "seguranca",
    to: "desktop",
    intent: "hardware-e-estacoes",
    id: "seguranca->desktop:hardware-e-estacoes:v1",
    template:
      "Responda ao agente de Seguranca com orientacoes sobre hardware, perifericos, estacoes e configuracoes locais que possam afetar controles de seguranca.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "suporte",
    to: "desktop",
    intent: "hardware-e-estacoes",
    id: "suporte->desktop:hardware-e-estacoes:v1",
    template:
      "Responda ao agente de Suporte com orientacoes sobre hardware, perifericos, estacoes de trabalho e softwares de produtividade local.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "desktop",
    to: "suporte",
    intent: "triagem-atendimento",
    id: "desktop->suporte:triagem-atendimento:v1",
    template:
      "Responda ao agente de Desktop com orientacoes de atendimento, SLA e fluxos de chamados operacionais.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "desktop",
    to: "desenvolvimento",
    intent: "escalonamento-tecnico",
    id: "desktop->desenvolvimento:escalonamento-tecnico:v1",
    template:
      "Responda ao agente de Desktop com foco em causa tecnica, API, deploy, integracao e passo corretivo de engenharia.",
    maxTokens: 420,
    enabled: true,
  },
  {
    from: "desktop",
    to: "seguranca",
    intent: "incidente-seguranca",
    id: "desktop->seguranca:incidente-seguranca:v1",
    template:
      "Responda ao agente de Desktop com orientacoes para classificacao, contencao e politica de incidente de seguranca.",
    maxTokens: 420,
    enabled: true,
  },
];

export function getProtocol(from: Sector, to: Sector, intent: string) {
  return PROTOCOLS.find(
    (protocol) =>
      protocol.from === from &&
      protocol.to === to &&
      protocol.intent === intent &&
      protocol.enabled,
  );
}

export function getAvailableTargets(origin: Sector) {
  const targets = PROTOCOLS.filter(
    (protocol) => protocol.from === origin && protocol.enabled,
  ).map((protocol) => ({
    target: protocol.to,
    intent: protocol.intent,
  }));

  const unique = new Map<Sector, (typeof targets)[number]>();
  for (const entry of targets) {
    if (!unique.has(entry.target)) {
      unique.set(entry.target, entry);
    }
  }
  return Array.from(unique.values());
}

export function formatProtocolQuestion(template: string, question: string) {
  return `${template}\n\nPergunta do agente origem:\n${question}`.trim();
}
