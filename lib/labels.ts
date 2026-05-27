import type { Sector } from "@/lib/domain";
import { isNativeSector } from "@/lib/domain";

export const SECTOR_LABELS: Record<Sector, string> = {
  desenvolvimento: "Desenvolvimento",
  seguranca: "Seguranca",
  suporte: "Suporte",
  desktop: "Desktop",
};

export const PERSONA_LABELS: Record<Sector, string> = {
  desenvolvimento: "Forja",
  seguranca: "Sentinela",
  suporte: "Helpdesk",
  desktop: "Desktop",
};

export function getSectorLabel(slug: string): string {
  if (isNativeSector(slug)) {
    return SECTOR_LABELS[slug];
  }
  // For dynamic sectors, capitalize the slug as a reasonable default.
  // The real label comes from SectorDefinition when available.
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
}
