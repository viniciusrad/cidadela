import { sendTeamsCard } from "@/lib/notifications/teams";
import { appConfig } from "@/lib/config";

// Carregar variáveis de ambiente do .env.local
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

async function main() {
  const webhookUrl = process.env.TEAMS_WEBHOOK_GAPS || process.env.TEAMS_WEBHOOK_DIGEST;

  if (!webhookUrl) {
    console.error("❌ Erro: Nenhuma URL de Webhook encontrada.");
    console.error("Verifique se TEAMS_WEBHOOK_GAPS ou TEAMS_WEBHOOK_DIGEST estão definidos no seu .env.local");
    process.exit(1);
  }

  console.log(`\nURL: ${webhookUrl.slice(0, 50)}...`);

  // Extrair tipo do host para dar uma pista do que estamos detectando
  try {
    const urlObj = new URL(webhookUrl);
    console.log(`Host detectado: ${urlObj.hostname}`);
    if (urlObj.hostname.includes("logic.azure") || urlObj.hostname.includes("powerplatform")) {
      console.log("=> Reconhecido como: Power Automate / Workflows (Adaptive Card esperado)");
    } else if (urlObj.hostname.includes("office.com")) {
      console.log("=> Reconhecido como: Legacy O365 Webhook (MessageCard esperado)");
    } else {
      console.log("=> Reconhecido como: Desconhecido (Caindo pro fallback padrão)");
    }
  } catch (e) {
    console.log("=> Hostname inválido!");
  }

  const result = await sendTeamsCard(webhookUrl, {
    title: "🚀 Teste de Integração - Agentes PFRM",
    summary: "Verificando conectividade do Webhook do Microsoft Teams",
    themeColor: "10B981", // Verde (Sucesso)
    facts: [
      { name: "Ambiente", value: "Desenvolvimento / Piloto" },
      { name: "Módulo", value: "Notificações (Onda 1)" },
      { name: "Status", value: "Online e operacional" },
    ],
    action: {
      label: "Abrir Painel de Agentes",
      url: appConfig.nextAuthUrl, // URL configurada no .env.local
    }
  });

  if (result.status === "sent") {
    console.log("✅ Mensagem enviada com sucesso ao Teams!");
    console.log(`Tentativas: ${result.attempts}`);
  } else if (result.status === "skipped") {
    console.log(`⚠️ Envio ignorado. Motivo: ${result.reason}`);
    console.log("Lembrete: O link do canal não é um Webhook válido. Você precisa criar um Incoming Webhook ou Power Automate.");
  } else {
    console.error("❌ Falha ao enviar a mensagem.");
    console.error(`Erro: ${result.error}`);
    console.error(`Tentativas: ${result.attempts}`);
  }
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exitCode = 1;
});
