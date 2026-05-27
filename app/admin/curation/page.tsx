import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CurationTabs } from "@/components/curation-tabs";
import { SecureAppShell } from "@/components/secure-app-shell";
import { prisma } from "@/lib/db/client";
import { isNativeSector } from "@/lib/domain";
import { normalizeDocumentType } from "@/lib/document-types";
import { isSectorSlug, listAllSectors } from "@/lib/sectors/sector-repo";

type SearchParams = Promise<{ sector?: string }>;

export default async function CurationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/chat");
  }

  const params = await searchParams;
  const rawSector = params.sector;
  const [allSectors, rawSectorIsValid] = await Promise.all([
    listAllSectors(),
    rawSector && rawSector !== "todos" ? isSectorSlug(rawSector) : false,
  ]);
  
  // Se for admin, pode ver 'todos' ou um setor específico. 
  // Se não for admin (embora o middleware de role acima bloqueie), veria apenas o seu.
  const selectedSector = session.user.role === "admin" 
    ? (rawSector === "todos" ? "todos" : (rawSector && rawSectorIsValid ? rawSector : "todos"))
    : (session.user.sector as string);
  const selectedNativeSector =
    selectedSector !== "todos" && isNativeSector(selectedSector)
      ? selectedSector
      : null;

  const documents = await prisma.curationDocument.findMany({
    where: {
      status: {
        in: [
          "STAGED",
          "IN_REVIEW",
          "NEEDS_REVISION",
          "READY_FOR_APPROVAL",
          "APPROVED",
          "PROMOTED",
          "REJECTED",
        ],
      },
      ...(selectedSector !== "todos" ? { sector: selectedSector } : {}),
    },
    orderBy: [{ status: "asc" }, { uploadedAt: "desc" }],
    take: 200,
  });
  const latestDocuments = Array.from(
    documents
      .reduce((map, document) => {
        const current = map.get(document.documentId);
        if (!current || current.uploadedAt < document.uploadedAt) {
          map.set(document.documentId, document);
        }
        return map;
      }, new Map<string, (typeof documents)[number]>())
      .values(),
  );
  const processGaps =
    selectedSector !== "todos" && !selectedNativeSector
      ? []
      : await prisma.processGapQuestion.findMany({
          where: {
            status: { in: ["promoted", "answered"] },
            ...(selectedNativeSector
              ? { processMap: { sector: selectedNativeSector } }
              : {}),
          },
          include: {
            processMap: {
              select: {
                id: true,
                name: true,
                sector: true,
              },
            },
            targetCurationDocument: {
              select: {
                id: true,
                documentId: true,
                documentTitle: true,
                fileName: true,
                status: true,
                reviews: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { questions: true },
                },
              },
            },
          },
          orderBy: [{ createdAt: "asc" }],
          take: 200,
        });

  const unansweredQuestions = await prisma.unansweredQuestion.findMany({
    where: {
      status: { in: ["open", "answered"] },
      ...(selectedSector !== "todos" ? { sector: selectedSector } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      askedBy: { select: { name: true, email: true } },
      resolvedBy: { select: { name: true, email: true } },
      conversation: { select: { title: true } },
      curationDocument: {
        select: { id: true, documentId: true, documentTitle: true, status: true },
      },
    },
  });
  const mapUnanswered = (
    item: (typeof unansweredQuestions)[number],
  ) => ({
    id: item.id,
    question: item.question,
    sector: item.sector,
    status: item.status,
    answerType: item.answerType,
    userName: item.askedBy?.name ?? null,
    userEmail: item.askedBy?.email ?? null,
    conversationTitle: item.conversation?.title ?? null,
    createdAt: item.createdAt.toISOString(),
    traceId: item.traceId,
    resolvedByName: item.resolvedBy?.name ?? null,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    notifiedAt: item.notifiedAt?.toISOString() ?? null,
    curationDocumentId: item.curationDocument?.id ?? null,
    curationDocumentTitle: item.curationDocument?.documentTitle ?? null,
    curationStatus: item.curationDocument?.status ?? null,
  });
  const unansweredOpen = unansweredQuestions
    .filter((item) => item.status === "open")
    .map(mapUnanswered);
  const unansweredAnswered = unansweredQuestions
    .filter((item) => item.status === "answered")
    .map(mapUnanswered);

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  return (
    <SecureAppShell
      currentPage="curation"
      description="Documentos enviados aguardam sua revisao antes de entrarem no chat. Aqui voce compara com o que ja esta publicado e aprova."
      hideHeader={true}
      title="Curadoria de conhecimento"
      user={user}
    >
      <CurationTabs
        documents={latestDocuments.map((document) => ({
          id: document.id,
          documentId: document.documentId,
          documentTitle: document.documentTitle,
          fileName: document.fileName,
          owner: document.owner,
          sector: document.sector,
          sopReadinessScore: document.sopReadinessScore,
          curationReadinessScore: document.curationReadinessScore,
          documentType: normalizeDocumentType(document.documentType),
          status: document.status,
          topic: document.topic,
          uploadedAt: document.uploadedAt.toISOString(),
        }))}
        processGaps={processGaps.map((gap) => ({
          id: gap.id,
          question: gap.question,
          rationale: gap.rationale,
          priority: gap.priority,
          status: gap.status,
          createdAt: gap.createdAt.toISOString(),
          processMapId: gap.processMapId,
          processName: gap.processMap.name,
          sector: gap.processMap.sector,
          targetCurationDocumentId: gap.targetCurationDocument?.id ?? null,
          targetDocumentId:
            gap.targetCurationDocument?.documentId ?? gap.targetDocumentId ?? null,
          targetDocumentTitle: gap.targetCurationDocument?.documentTitle ?? null,
          targetFileName: gap.targetCurationDocument?.fileName ?? null,
          targetStatus: gap.targetCurationDocument?.status ?? null,
          response: (() => {
            if (!Array.isArray(gap.targetCurationDocument?.reviews[0]?.questions)) {
              return null;
            }
            const reviewQuestion = gap.targetCurationDocument.reviews[0].questions.find(
              (question) =>
                question &&
                typeof question === "object" &&
                "id" in question &&
                question.id === `process_gap_${gap.id}`,
            ) as { response?: unknown } | undefined;
            return typeof reviewQuestion?.response === "string"
              ? reviewQuestion.response
              : null;
          })(),
        }))}
        unansweredOpen={unansweredOpen}
        unansweredAnswered={unansweredAnswered}
        selectedSector={selectedSector}
        sectorOptions={allSectors.map((sector) => ({
          slug: sector.slug,
          displayName: sector.displayName,
          agentName: sector.agentName,
        }))}
        user={user}
      />
    </SecureAppShell>
  );
}
