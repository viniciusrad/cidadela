export type Salutation = "Bom dia" | "Boa tarde" | "Boa noite";

export function getGreeting(now: Date = new Date()): Salutation {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  const hour = Number.parseInt(formatter.format(now), 10);

  if (hour >= 5 && hour < 12) {
    return "Bom dia";
  }
  if (hour >= 12 && hour < 18) {
    return "Boa tarde";
  }
  return "Boa noite";
}
