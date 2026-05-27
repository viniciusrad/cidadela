import { listPersonProfiles } from "@/lib/graph/person-registry";

const JOB_TITLE_LEVEL: Record<string, number> = {
  diretor: 1, diretora: 1,
  gerente: 2,
  coordenador: 3, coordenadora: 3,
  especialista: 4,
  analista: 5,
  tecnico: 6, tecnica: 6,
  assistente: 7,
};

function titleLevel(title: string | null): number {
  if (!title) return 99;
  const n = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return JOB_TITLE_LEVEL[n] ?? 50;
}

export type OrgPerson = {
  name: string;
  email: string | null;
  jobTitle: string | null;
  primarySector: string | null;
  performsCount: number;
  documentCount: number;
  isKeyPerson: boolean;
};

export type OrgSector = {
  slug: string;
  displayName: string;
  persons: OrgPerson[];
};

export type OrgChartData = {
  sectors: OrgSector[];
  unassigned: OrgPerson[];
  allJobTitles: string[];
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sortPersonsByTitle(persons: OrgPerson[]): OrgPerson[] {
  return [...persons].sort((a, b) => {
    const diff = titleLevel(a.jobTitle) - titleLevel(b.jobTitle);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

export async function getOrgChart(): Promise<OrgChartData> {
  const profiles = await listPersonProfiles();

  const titleSet = new Set<string>();
  for (const p of profiles) {
    if (p.jobTitle) titleSet.add(p.jobTitle);
  }
  const allJobTitles = Array.from(titleSet).sort(
    (a, b) => titleLevel(a) - titleLevel(b) || a.localeCompare(b),
  );

  const sectorMap = new Map<string, OrgPerson[]>();
  const unassigned: OrgPerson[] = [];

  for (const profile of profiles) {
    const person: OrgPerson = {
      name: profile.name,
      email: profile.email,
      jobTitle: profile.jobTitle ?? null,
      primarySector: profile.primarySector,
      performsCount: profile.performsCount,
      documentCount: profile.documentCount,
      isKeyPerson: profile.isKeyPerson,
    };

    const sector = profile.primarySector ?? profile.belongsToSectors[0] ?? null;
    if (sector) {
      if (!sectorMap.has(sector)) sectorMap.set(sector, []);
      sectorMap.get(sector)!.push(person);
    } else {
      unassigned.push(person);
    }
  }

  const sectors: OrgSector[] = Array.from(sectorMap.entries())
    .map(([slug, persons]) => ({
      slug,
      displayName: capitalize(slug),
      persons: sortPersonsByTitle(persons),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    sectors,
    unassigned: sortPersonsByTitle(unassigned),
    allJobTitles,
  };
}
