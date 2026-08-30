import type { DocumentStatus, Prisma, Sector, UserRole } from "@prisma/client";

import { appConfig, isSector } from "@/lib/config";
import {
  calculateCurationReadiness,
  requiredCurationQuestions,
} from "@/lib/curation/profiles";
import { prisma } from "@/lib/db/client";
import { normalizeDocumentType } from "@/lib/document-types";
import type { CurationFrontmatter } from "@/lib/frontmatter";
import { type CurationQuestion } from "@/lib/sop-readiness";

export type CurationActor = {
  id: string;
  email: string;
  role: UserRole;
  sector: Sector;
};

export type CurationDocumentWithRelations = Prisma.CurationDocumentGetPayload<{
  include: {
    reviews: { orderBy: { createdAt: "desc" }; take: 1 };
    approvals: true;
    correlationRuns: { orderBy: { createdAt: "desc" }; take: 1 };
    uploadedBy: { select: { email: true } };
  };
}>;

export function metadataFromDocument(
  document: {
    documentTitle: string;
    sector: string;
    owner: string | null;
    sensitivity: string | null;
    effectiveFrom: Date | null;
    supersedes: string | null;
    topic: string | null;
  },
): CurationFrontmatter {
  return {
    title: document.documentTitle,
    sector: document.sector,
    owner: document.owner ?? undefined,
    sensitivity: (document.sensitivity ?? undefined) as
      | CurationFrontmatter["sensitivity"]
      | undefined,
    effectiveFrom: document.effectiveFrom ?? undefined,
    supersedes: document.supersedes ?? undefined,
    topic: document.topic ?? undefined,
  };
}

export function questionsFromReview(review?: { questions: Prisma.JsonValue }) {
  if (!review || !Array.isArray(review.questions)) {
    return [] as CurationQuestion[];
  }

  return review.questions.filter((question): question is CurationQuestion => {
    if (!question || typeof question !== "object") {
      return false;
    }

    return "id" in question && "type" in question && "prompt" in question;
  });
}

export function splitCurationQuestions(questions: CurationQuestion[]) {
  return {
    templateQuestions: questions.filter(
      (question) => !question.source || question.source === "template",
    ),
    derivedQuestions: questions.filter(
      (question) => question.source === "inferred" || question.source === "process_gap",
    ),
  };
}

export function recomputeReadiness(input: {
  documentType?: string | null;
  metadata: CurationFrontmatter;
  markdown: string;
  questions: CurationQuestion[];
}) {
  const documentType = normalizeDocumentType(input.documentType);
  const { templateQuestions } = splitCurationQuestions(input.questions);
  const questions = requiredCurationQuestions(
    documentType,
    input.metadata,
    templateQuestions,
  );
  return {
    questions,
    readiness: calculateCurationReadiness({
      documentType,
      metadata: input.metadata,
      markdown: input.markdown,
      questions,
    }),
  };
}

export function statusForReadiness(score: number): DocumentStatus {
  return score >= appConfig.sopReadinessThreshold
    ? "READY_FOR_APPROVAL"
    : "NEEDS_REVISION";
}

export async function findCurationDocumentForActor(
  curationDocumentId: string,
  actor: CurationActor,
) {
  const document = await prisma.curationDocument.findFirst({
    where: {
      id: curationDocumentId,
      ...(actor.role === "admin" ? {} : { sector: actor.sector }),
    },
    include: {
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      approvals: true,
      correlationRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      uploadedBy: {
        select: { email: true },
      },
    },
  });

  return document;
}

export function latestCorrelationRun(
  document: { correlationRuns?: CurationDocumentWithRelations["correlationRuns"] },
) {
  return document.correlationRuns?.[0] ?? null;
}

export function canEditCurationDocument(
  document: { uploadedById: string; owner: string | null; sector: string },
  actor: CurationActor,
) {
  if (actor.role === "admin") {
    return true;
  }

  return (
    document.sector === actor.sector &&
    (document.uploadedById === actor.id || document.owner === actor.email)
  );
}

export function canAdministerCurationDocument(actor: CurationActor) {
  return actor.role === "admin";
}

export async function canApproveAsOwner(
  document: {
    sector: string;
    topic: string | null;
    owner: string | null;
  },
  actor: CurationActor,
) {
  if (actor.role === "admin" && appConfig.curationAllowSameUserDualApproval) {
    return true;
  }

  if (document.sector !== actor.sector) {
    return false;
  }

  if (document.owner === actor.email) {
    return true;
  }

  if (document.topic && isSector(document.sector)) {
    const owner = await prisma.knowledgeOwner.findUnique({
      where: {
        topic_sector: {
          topic: document.topic,
          sector: document.sector,
        },
      },
    });

    if (owner?.userEmail === actor.email) {
      return true;
    }
  }

  return false;
}

export function hasRequiredApprovals(
  approvals: Array<{
    approverId: string;
    approverRole: string;
    decision: string;
  }>,
) {
  const approved = approvals.filter((approval) => approval.decision === "approved");
  return approved.some(
    (approval) =>
      approval.approverRole === "owner" || approval.approverRole === "admin",
  );
}

export function approvalGateFromApprovals(
  approvals: Array<{
    approverId: string;
    approverRole: string;
    decision: string;
  }>,
) {
  const approved = approvals.filter((approval) => approval.decision === "approved");
  const hasOwnerApproval = approved.some(
    (approval) => approval.approverRole === "owner",
  );
  const hasAdminApproval = approved.some(
    (approval) => approval.approverRole === "admin",
  );
  const hasAnyApproval = hasOwnerApproval || hasAdminApproval;
  const missingApprovals: Array<"owner" | "admin"> = [];

  if (!hasAnyApproval) {
    missingApprovals.push("owner");
    missingApprovals.push("admin");
  }

  return {
    requiresOwnerApproval: true,
    requiresAdminApproval: true,
    allowSameUserDualApproval: appConfig.curationAllowSameUserDualApproval,
    hasOwnerApproval,
    hasAdminApproval,
    hasAnyApproval,
    missingApprovals,
    canPromote: hasRequiredApprovals(approvals),
  };
}

export function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
