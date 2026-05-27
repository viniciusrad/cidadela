"use client";

import {
  Building2,
  ChevronDown,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  User,
  X,
  Check,
} from "lucide-react";
import { useEffect, useState } from "react";

type OrgPerson = {
  name: string;
  email: string | null;
  jobTitle: string | null;
  primarySector: string | null;
  performsCount: number;
  documentCount: number;
  isKeyPerson: boolean;
};

type OrgSector = {
  slug: string;
  displayName: string;
  persons: OrgPerson[];
};

type OrgChartData = {
  sectors: OrgSector[];
  unassigned: OrgPerson[];
  allJobTitles: string[];
};

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

function groupByTitle(persons: OrgPerson[]): Array<{ label: string; persons: OrgPerson[] }> {
  const groups = new Map<string, OrgPerson[]>();
  for (const p of persons) {
    const key = p.jobTitle ?? "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => titleLevel(a === "__none__" ? null : a) - titleLevel(b === "__none__" ? null : b))
    .map(([key, persons]) => ({ label: key === "__none__" ? "Sem cargo" : key, persons }));
}

// ─── Add job title button ──────────────────────────────────────────────────────

function AddJobTitleButton({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-3.5 w-3.5" />
        Novo cargo
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
          <input
            autoFocus
            className="w-44 rounded-lg border border-[var(--border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Ex: analista"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
          />
          <button
            className="rounded-lg bg-[var(--accent)] p-1.5 text-white hover:opacity-90 disabled:opacity-50"
            disabled={!value.trim()}
            onClick={submit}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Person card ───────────────────────────────────────────────────────────────

function PersonCard({
  person,
  selected,
  onClick,
}: {
  person: OrgPerson;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Clique para editar setor e cargo"
      className={`group w-full rounded-xl border bg-white px-3 py-2 text-left transition-all hover:border-[var(--accent)] hover:shadow-sm ${
        selected
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)] ring-offset-1"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          {person.isKeyPerson
            ? <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
            : <User className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[var(--foreground-strong)]">
            {person.name}
          </span>
          {person.jobTitle
            ? (
              <span className="mt-0.5 inline-block rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
                {person.jobTitle}
              </span>
            )
            : (
              <span className="mt-0.5 inline-block rounded-full border border-dashed border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                + cargo
              </span>
            )}
          <span className="block text-[10px] text-[var(--muted)]">
            {person.documentCount} doc{person.documentCount !== 1 ? "s" : ""}
          </span>
        </span>
        <Edit2 className="h-3 w-3 shrink-0 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ─── Sector column ─────────────────────────────────────────────────────────────

function SectorColumn({
  displayName,
  persons,
  selectedName,
  onSelect,
}: {
  slug: string;
  displayName: string;
  persons: OrgPerson[];
  selectedName: string | null;
  onSelect: (person: OrgPerson) => void;
}) {
  const groups = groupByTitle(persons);

  return (
    <div className="flex w-52 shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2">
        <Building2 className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
        <span className="flex-1 truncate text-xs font-bold text-[var(--accent-strong)]">{displayName}</span>
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-strong)]">
          {persons.length}
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            {group.label}
          </p>
          {group.persons.map((person) => (
            <PersonCard
              key={person.name}
              person={person}
              selected={selectedName === person.name}
              onClick={() => onSelect(person)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Edit person panel ─────────────────────────────────────────────────────────

function EditPersonPanel({
  person,
  allJobTitles,
  sectors,
  onSave,
  onClose,
}: {
  person: OrgPerson;
  allJobTitles: string[];
  sectors: string[];
  onSave: () => void;
  onClose: () => void;
}) {
  const [sectorValue, setSectorValue] = useState(person.primarySector ?? "");
  const [jobTitleValue, setJobTitleValue] = useState(person.jobTitle ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSectorValue(person.primarySector ?? "");
    setJobTitleValue(person.jobTitle ?? "");
  }, [person.name, person.primarySector, person.jobTitle]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/admin/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: person.name,
          manualSector: sectorValue || null,
          jobTitle: jobTitleValue || null,
        }),
      });
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-[var(--accent)] bg-white shadow-md">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 rounded-t-2xl">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
          <Edit2 className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--foreground-strong)] truncate">{person.name}</p>
          <p className="text-[10px] text-[var(--muted)]">
            {person.jobTitle
              ? <>Cargo atual: <strong>{person.jobTitle}</strong></>
              : <span className="italic">Sem cargo atribuído</span>}
            {person.primarySector && <> · Setor: <strong>{person.primarySector}</strong></>}
          </p>
        </div>
        <button
          className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white hover:text-[var(--foreground)] transition-colors"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex flex-wrap items-end gap-4 px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Setor
          </label>
          <input
            className="w-48 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            list="sector-options"
            placeholder="Ex: seguranca"
            value={sectorValue}
            onChange={(e) => setSectorValue(e.target.value)}
          />
          <datalist id="sector-options">
            {sectors.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Cargo / Posição
          </label>
          <div className="relative">
            <input
              autoFocus
              className="w-48 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 pr-8 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              list="job-title-options"
              placeholder="Ex: analista, gerente…"
              value={jobTitleValue}
              onChange={(e) => setJobTitleValue(e.target.value)}
            />
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          </div>
          <datalist id="job-title-options">
            {allJobTitles.map((t) => <option key={t} value={t} />)}
          </datalist>
          {allJobTitles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {allJobTitles.slice(0, 6).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setJobTitleValue(t)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    jobTitleValue === t
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pb-0.5">
          <button
            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>
              <Check className="h-4 w-4" /> Salvar
            </>}
          </button>
          <button
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel root ────────────────────────────────────────────────────────────────

export function OrgChartPanel() {
  const [data, setData] = useState<OrgChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<OrgPerson | null>(null);
  const [customTitles, setCustomTitles] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/org-chart");
      if (res.ok) {
        const json = await res.json() as OrgChartData;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const handleAddTitle = (title: string) => {
    setCustomTitles((prev) => (prev.includes(title) ? prev : [...prev, title]));
    if (selectedPerson) {
      setSelectedPerson({ ...selectedPerson, jobTitle: title });
    }
  };

  const allJobTitles = [
    ...(data?.allJobTitles ?? []),
    ...customTitles.filter((t) => !data?.allJobTitles.includes(t)),
  ];

  const knownSectors = [
    ...(data?.sectors.map((s) => s.slug) ?? []),
    ...(data?.unassigned.map((p) => p.primarySector).filter(Boolean) as string[] ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando organograma...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] py-12 text-center text-sm text-[var(--muted)]">
        Nenhum dado disponível.
      </div>
    );
  }

  const unassignedCount = data.unassigned.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AddJobTitleButton onAdd={handleAddTitle} />
        <p className="text-xs text-[var(--muted)]">
          Clique em uma pessoa para editar setor e cargo
        </p>
        <div className="ml-auto flex gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
            onClick={() => void loadData()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 min-h-64">
        {data.sectors.map((sector) => (
          <SectorColumn
            key={sector.slug}
            slug={sector.slug}
            displayName={sector.displayName}
            persons={sector.persons}
            selectedName={selectedPerson?.name ?? null}
            onSelect={setSelectedPerson}
          />
        ))}
        {unassignedCount > 0 && (
          <SectorColumn
            key="__unassigned__"
            slug="__unassigned__"
            displayName="Sem setor"
            persons={data.unassigned}
            selectedName={selectedPerson?.name ?? null}
            onSelect={setSelectedPerson}
          />
        )}
        {data.sectors.length === 0 && unassignedCount === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-12 text-sm text-[var(--muted)]">
            Nenhuma pessoa no grafo.
          </div>
        )}
      </div>

      {selectedPerson && (
        <EditPersonPanel
          person={selectedPerson}
          allJobTitles={allJobTitles}
          sectors={knownSectors}
          onSave={async () => { setSelectedPerson(null); await loadData(); }}
          onClose={() => setSelectedPerson(null)}
        />
      )}
    </div>
  );
}
