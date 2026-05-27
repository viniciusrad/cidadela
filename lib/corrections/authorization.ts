import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { SECTORS, type Sector, type UserRole } from "@/lib/domain";

export type CorrectionActor = {
  id: string;
  email: string;
  role: UserRole;
  sector: Sector;
};

export async function correctionReviewSectors(actor: CorrectionActor) {
  if (actor.role === "admin") {
    return [...SECTORS];
  }

  const [ownerRows, documentRows] = await Promise.all([
    prisma.knowledgeOwner.findMany({
      where: {
        userEmail: actor.email,
        sector: actor.sector,
      },
      select: { sector: true },
    }),
    prisma.curationDocument.findMany({
      where: {
        owner: actor.email,
        sector: actor.sector,
      },
      select: { sector: true },
      distinct: ["sector"],
    }),
  ]);

  return Array.from(
    new Set([...ownerRows, ...documentRows].map((row) => row.sector)),
  ).filter(isSector);
}

export async function canReviewCorrections(actor: CorrectionActor) {
  return (await correctionReviewSectors(actor)).length > 0;
}

export async function canReviewCorrectionSector(
  actor: CorrectionActor,
  sector: Sector,
) {
  return (await correctionReviewSectors(actor)).includes(sector);
}
