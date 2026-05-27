"use client";

import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  Cog,
  Edit2,
  GitMerge,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  Users,
  X,
} from "lucide-react";
import { OrgChartPanel } from "./org-chart-panel";
import { useCallback, useEffect, useMemo, useState } from "react";

type PersonProfile = {
  name: string;
  email: string | null;
  primarySector: string | null;
  manualSector: string | null;
  jobTitle: string | null;
  documentCount: number;
  chunkCount: number;
  sectors: string[];
  performsCount: number;
  usesCount: number;
  belongsToSectors: string[];
  participatesInProcesses: number;
  knowsAboutCount: number;
  isKeyPerson: boolean;
};

type PersonRelations = {
  performs: Array<{ procedureName: string; role: string; confidence: string }>;
  uses: Array<{ systemName: string; confidence: string }>;
  participatesIn: Array<{ processName: string; roles: string[]; sector: string }>;
  knowsAbout: Array<{ conceptName: string; strength: number }>;
  belongsTo: Array<{ sectorSlug: string; isPrimary: boolean; docCount: number }>;
};

type DuplicateCluster = {
  id: string;
  members: PersonProfile[];
};

const CONFIDENCE_LABEL: Record<string, string> = {
  extracted: "detectado",
  co_occurrence: "co-menção",
  human_validated: "validado",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  extracted: "bg-blue-50 text-blue-700 border-blue-200",
  co_occurrence: "bg-amber-50 text-amber-700 border-amber-200",
  human_validated: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// ─── Similarity helpers ────────────────────────────────────────────────────────

function normalizeToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function tokens(name: string): string[] {
  return name.split(/\s+/).map(normalizeToken).filter(Boolean);
}

function areSimilarNames(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const na = ta.join(" ");
  const nb = tb.join(" ");
  // One is a prefix of the other (e.g. "vinicius" ⊂ "vinicius ribeiro")
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  // Share first token AND at least one other token
  if (ta[0] === tb[0] && ta.some((t) => t.length > 2 && tb.includes(t))) return true;
  // Share first token and one is a single-token name
  if (ta[0] === tb[0] && (ta.length === 1 || tb.length === 1)) return true;

  return false;
}

function buildDuplicateClusters(profiles: PersonProfile[]): DuplicateCluster[] {
  const assigned = new Set<string>();
  const clusters: DuplicateCluster[] = [];

  for (let i = 0; i < profiles.length; i++) {
    if (assigned.has(profiles[i].name)) continue;
    const group: PersonProfile[] = [profiles[i]];

    for (let j = i + 1; j < profiles.length; j++) {
      if (assigned.has(profiles[j].name)) continue;
      if (areSimilarNames(profiles[i].name, profiles[j].name)) {
        group.push(profiles[j]);
        assigned.add(profiles[j].name);
      }
    }

    if (group.length >= 2) {
      assigned.add(profiles[i].name);
      // Sort: most documents first (best candidate for canonical)
      group.sort((a, b) => b.documentCount - a.documentCount);
      clusters.push({ id: profiles[i].name, members: group });
    }
  }

  return clusters;
}

// ─── Panel root ────────────────────────────────────────────────────────────────

export function PersonRegistryPanel() {
  const [profiles, setProfiles] = useState<PersonProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"pessoas" | "deduplicar" | "organograma">("pessoas");

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/persons");
      if (res.ok) {
        const data = await res.json() as { profiles: PersonProfile[] };
        setProfiles(data.profiles ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfiles();
  }, [loadProfiles]);

  const clusters = useMemo(() => buildDuplicateClusters(profiles), [profiles]);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-white p-1">
        <TabButton active={activeTab === "pessoas"} onClick={() => setActiveTab("pessoas")}>
          <User className="h-3.5 w-3.5" />
          Pessoas
          <span className="ml-1 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-strong)]">
            {profiles.length}
          </span>
        </TabButton>
        <TabButton active={activeTab === "deduplicar"} onClick={() => setActiveTab("deduplicar")}>
          <GitMerge className="h-3.5 w-3.5" />
          Deduplicar
          {clusters.length > 0 && (
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              {clusters.length}
            </span>
          )}
        </TabButton>
        <TabButton active={activeTab === "organograma"} onClick={() => setActiveTab("organograma")}>
          <Building2 className="h-3.5 w-3.5" />
          Organograma
        </TabButton>
        <div className="ml-auto">
          <button
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
            onClick={() => void loadProfiles()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {activeTab === "pessoas" && (
        <PeopleTab profiles={profiles} loading={loading} onRefresh={loadProfiles} />
      )}
      {activeTab === "deduplicar" && (
        <DeduplicateTab clusters={clusters} loading={loading} onRefresh={loadProfiles} />
      )}
      {activeTab === "organograma" && <OrgChartPanel />}
    </div>
  );
}

// ─── Tab button ────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--accent)] text-white"
          : "text-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Pessoas tab ───────────────────────────────────────────────────────────────

function PeopleTab({
  profiles,
  loading,
  onRefresh,
}: {
  profiles: PersonProfile[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [relations, setRelations] = useState<PersonRelations | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNewName, setEditNewName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editSector, setEditSector] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const loadRelations = async (name: string) => {
    setRelationsLoading(true);
    try {
      const res = await fetch(`/api/admin/persons?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json() as { relations: PersonRelations };
        setRelations(data.relations ?? null);
      }
    } finally {
      setRelationsLoading(false);
    }
  };

  const toggleExpand = (name: string) => {
    if (expandedName === name) {
      setExpandedName(null);
      setRelations(null);
    } else {
      setExpandedName(name);
      setRelations(null);
      void loadRelations(name);
    }
  };

  const startEdit = (profile: PersonProfile) => {
    setEditingName(profile.name);
    setEditNewName(profile.name);
    setEditEmail(profile.email ?? "");
    setEditSector(profile.manualSector ?? profile.primarySector ?? "");
  };

  const saveEdit = async (currentName: string) => {
    setSaving(true);
    try {
      let finalName = currentName;
      const trimmedNew = editNewName.trim();

      if (trimmedNew && trimmedNew !== currentName) {
        const res = await fetch("/api/admin/persons/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentName, newName: trimmedNew }),
        });
        if (res.ok) finalName = trimmedNew;
      }

      await fetch("/api/admin/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, email: editEmail || null, manualSector: editSector || null }),
      });

      setEditingName(null);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const addPerson = async () => {
    if (!newPersonName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPersonName.trim() }),
      });
      setNewPersonName("");
      setShowAddForm(false);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const filtered = profiles.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="w-full rounded-xl border border-[var(--border)] bg-white py-2 pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowAddForm((v) => !v)}
        >
          <User className="h-4 w-4" />
          Cadastrar
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[var(--accent-strong)]">Nova pessoa</p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="Nome completo"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addPerson()}
            />
            <button
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              disabled={saving || !newPersonName.trim()}
              onClick={() => void addPerson()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adicionar"}
            </button>
            <button
              className="rounded-xl border border-[var(--border)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={() => { setShowAddForm(false); setNewPersonName(""); }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!loading && (
        <p className="text-xs text-[var(--muted)]">
          {filtered.length} pessoa{filtered.length !== 1 ? "s" : ""} encontrada{filtered.length !== 1 ? "s" : ""}
          {profiles.filter((p) => p.isKeyPerson).length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200">
              <ShieldAlert className="h-3 w-3" />
              {profiles.filter((p) => p.isKeyPerson).length} pessoa-chave
            </span>
          )}
        </p>
      )}

      <div className="space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--muted)]">
            Nenhuma pessoa encontrada no grafo.
          </div>
        )}

        {filtered.map((profile) => (
          <div key={profile.name} className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                className="flex flex-1 items-center gap-3 text-left min-w-0"
                onClick={() => toggleExpand(profile.name)}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  {profile.isKeyPerson
                    ? <ShieldAlert className="h-4 w-4 text-red-500" />
                    : <User className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-[var(--foreground-strong)]">{profile.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {profile.email ?? <span className="italic">sem e-mail</span>}
                    {profile.primarySector && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
                        {profile.manualSector ? "✓ " : ""}{profile.primarySector}
                      </span>
                    )}
                  </span>
                </span>
                {expandedName === profile.name
                  ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[var(--muted)]" />
                  : <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--muted)]" />}
              </button>

              <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted)]">
                {profile.performsCount > 0 && (
                  <span title="Procedimentos" className="flex items-center gap-1">
                    <Cog className="h-3 w-3" />{profile.performsCount}
                  </span>
                )}
                {profile.participatesInProcesses > 0 && (
                  <span title="Processos" className="flex items-center gap-1">
                    <Layers className="h-3 w-3" />{profile.participatesInProcesses}
                  </span>
                )}
                {profile.knowsAboutCount > 0 && (
                  <span title="Conceitos" className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />{profile.knowsAboutCount}
                  </span>
                )}
                <span className="text-[10px]">{profile.documentCount} doc{profile.documentCount !== 1 ? "s" : ""}</span>
              </div>

              <button
                className="shrink-0 rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                title="Editar / renomear"
                onClick={(e) => { e.stopPropagation(); startEdit(profile); }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Inline edit */}
            {editingName === profile.name && (
              <div className="border-t border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--accent-strong)]">Editar perfil</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="w-28 shrink-0 text-xs text-[var(--muted)]">Nome canônico</label>
                    <input
                      className="flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      value={editNewName}
                      onChange={(e) => setEditNewName(e.target.value)}
                      placeholder="Renomear para..."
                    />
                    {editNewName.trim() !== profile.name && editNewName.trim() && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        renomear
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="flex-1 min-w-40 rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder="E-mail (@empresa.com)"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                    <input
                      className="w-44 rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder="Setor (ex: seguranca)"
                      value={editSector}
                      onChange={(e) => setEditSector(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                      disabled={saving}
                      onClick={() => void saveEdit(profile.name)}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                    </button>
                    <button
                      className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                      onClick={() => setEditingName(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Expanded relations */}
            {expandedName === profile.name && (
              <div className="border-t border-[var(--border)] bg-gray-50 px-4 py-3">
                {relationsLoading && (
                  <div className="flex items-center gap-2 py-2 text-sm text-[var(--muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando relações...
                  </div>
                )}
                {relations && !relationsLoading && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {relations.performs.length > 0 && (
                      <RelationGroup label="Executa / responsável" items={relations.performs.map((r) => ({ label: r.procedureName, badge: r.role, confidence: r.confidence }))} />
                    )}
                    {relations.uses.length > 0 && (
                      <RelationGroup label="Utiliza sistemas" items={relations.uses.map((r) => ({ label: r.systemName, confidence: r.confidence }))} />
                    )}
                    {relations.participatesIn.length > 0 && (
                      <RelationGroup label="Participa de processos" items={relations.participatesIn.map((r) => ({ label: r.processName, badge: r.sector, confidence: "extracted" }))} />
                    )}
                    {relations.knowsAbout.length > 0 && (
                      <RelationGroup label="Conhece conceitos" items={relations.knowsAbout.map((r) => ({ label: r.conceptName, badge: `força ${r.strength}`, confidence: "extracted" }))} />
                    )}
                    {relations.belongsTo.length > 0 && (
                      <RelationGroup label="Pertence a setores" items={relations.belongsTo.map((r) => ({ label: r.sectorSlug, badge: r.isPrimary ? "principal" : undefined, confidence: r.isPrimary ? "human_validated" : "extracted" }))} />
                    )}
                    {relations.performs.length === 0 && relations.uses.length === 0 && relations.participatesIn.length === 0 && (
                      <p className="col-span-full text-xs text-[var(--muted)]">
                        Nenhuma relação tipada. Execute o backfill após extração.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Deduplicar tab ────────────────────────────────────────────────────────────

function DeduplicateTab({
  clusters,
  loading,
  onRefresh,
}: {
  clusters: DuplicateCluster[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = clusters.filter((c) => !dismissed.has(c.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--muted)]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analisando nomes...
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] py-12 text-center">
        <Users className="mx-auto mb-3 h-8 w-8 text-[var(--muted)]" />
        <p className="text-sm font-medium text-[var(--foreground)]">Nenhuma duplicata detectada</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Todos os nomes cadastrados parecem únicos com base na similaridade de tokens.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        {visible.length} grupo{visible.length !== 1 ? "s" : ""} de possíveis duplicatas detectado{visible.length !== 1 ? "s" : ""}.
        Selecione o nome canônico e mescle as referências.
      </p>
      {visible.map((cluster) => (
        <MergeClusterCard
          key={cluster.id}
          cluster={cluster}
          onDismiss={() => setDismissed((s) => new Set([...s, cluster.id]))}
          onMerged={async () => { setDismissed((s) => new Set([...s, cluster.id])); await onRefresh(); }}
        />
      ))}
    </div>
  );
}

// ─── Merge cluster card ────────────────────────────────────────────────────────

function MergeClusterCard({
  cluster,
  onDismiss,
  onMerged,
}: {
  cluster: DuplicateCluster;
  onDismiss: () => void;
  onMerged: () => Promise<void>;
}) {
  const [canonicalName, setCanonicalName] = useState(cluster.members[0].name);
  const [customName, setCustomName] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [selectedAliases, setSelectedAliases] = useState<Set<string>>(
    new Set(cluster.members.slice(1).map((m) => m.name)),
  );
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<{ merged: string[]; edgesTransferred: number } | null>(null);

  const effectiveCanonical = useCustom ? customName.trim() : canonicalName;
  const aliases = cluster.members.map((m) => m.name).filter((n) => n !== effectiveCanonical && selectedAliases.has(n));

  const toggleAlias = (name: string) => {
    setSelectedAliases((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const doMerge = async () => {
    if (!effectiveCanonical || aliases.length === 0) return;
    setMerging(true);
    try {
      const res = await fetch("/api/admin/persons/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical: effectiveCanonical, aliases }),
      });
      if (res.ok) {
        const data = await res.json() as { merged: string[]; edgesTransferred: number };
        setResult(data);
        await onMerged();
      }
    } finally {
      setMerging(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">
          ✓ Mesclado em <strong>{effectiveCanonical}</strong>
        </p>
        <p className="mt-0.5 text-xs text-emerald-600">
          {result.merged.length} alias{result.merged.length !== 1 ? "es" : ""} absorvido{result.merged.length !== 1 ? "s" : ""},&nbsp;
          {result.edgesTransferred} relações transferidas
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-bold uppercase tracking-widest text-amber-700">
            Possível duplicata — {cluster.members.length} nomes
          </span>
        </div>
        <button
          className="rounded-lg p-1 text-amber-400 hover:text-amber-700 transition-colors"
          title="Ignorar este grupo"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Member list with checkboxes */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Selecione quais são a mesma pessoa
          </p>
          {cluster.members.map((member) => {
            const isCanonical = member.name === effectiveCanonical && !useCustom;
            const isSelected = selectedAliases.has(member.name);

            return (
              <label
                key={member.name}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                  isCanonical
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : isSelected
                    ? "border-amber-200 bg-amber-50"
                    : "border-[var(--border)] bg-gray-50"
                }`}
              >
                {!isCanonical && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleAlias(member.name)}
                    className="accent-amber-500"
                  />
                )}
                {isCanonical && <span className="h-4 w-4 shrink-0" />}

                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--foreground-strong)]">
                    {member.name}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {member.documentCount} doc{member.documentCount !== 1 ? "s" : ""}
                    {member.performsCount > 0 && ` · ${member.performsCount} proc.`}
                    {member.usesCount > 0 && ` · ${member.usesCount} sist.`}
                    {member.primarySector && ` · ${member.primarySector}`}
                  </span>
                </span>

                {isCanonical && (
                  <span className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-white">
                    canônico
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/* Canonical name selector */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Nome canônico</p>
          <div className="flex flex-wrap gap-2">
            {cluster.members.map((member) => (
              <button
                key={member.name}
                onClick={() => { setCanonicalName(member.name); setUseCustom(false); }}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                  !useCustom && canonicalName === member.name
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)]"
                }`}
              >
                {member.name}
              </button>
            ))}
            <button
              onClick={() => setUseCustom(true)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                useCustom
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-dashed border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
            >
              + Outro nome
            </button>
          </div>

          {useCustom && (
            <input
              autoFocus
              className="w-full rounded-xl border border-[var(--accent)] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="Nome canônico personalizado..."
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            disabled={merging || !effectiveCanonical || aliases.length === 0}
            onClick={() => void doMerge()}
          >
            {merging
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <GitMerge className="h-4 w-4" />}
            Mesclar {aliases.length > 0 ? `(${aliases.length} alias)` : ""}
          </button>
          <button
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            onClick={onDismiss}
          >
            Ignorar
          </button>
          {aliases.length === 0 && (
            <span className="text-xs text-[var(--muted)]">Selecione ao menos um alias</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Relation group ────────────────────────────────────────────────────────────

function RelationGroup({ label, items }: {
  label: string;
  items: Array<{ label: string; badge?: string; confidence: string }>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-[var(--foreground)]">{item.label}</span>
            <div className="flex shrink-0 items-center gap-1">
              {item.badge && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{item.badge}</span>
              )}
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${CONFIDENCE_COLOR[item.confidence] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
                {CONFIDENCE_LABEL[item.confidence] ?? item.confidence}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
