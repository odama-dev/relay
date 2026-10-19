"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { UserRole } from "@prisma/client";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { AttentionRules } from "@/lib/clevel/pure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { PillSelect } from "@/components/pill-select";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import {
  addCapacityOverride,
  deleteCapacity,
  deleteCapacityOverride,
  deleteFxRate,
  deletePersonCost,
  saveCapacity,
  saveDashboardRules,
  saveFxRate,
  savePersonCost,
  saveRevenueTargets,
  saveRoleTargets,
  setPersonTarget,
} from "./actions";

type Person = { id: string; name: string; role: UserRole; roleLabel: string };
type Result = { ok: boolean; error?: string };

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (p: Promise<Result>, success?: string) => {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (success) toast.success(success);
    router.refresh();
    return true;
  };
  return { act, busy };
}

function Intro({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground max-w-2xl text-body">{children}</p>;
}

/** A card holding an inline "add" form — fields wrap on small screens. */
function AddForm({ title, children, onSubmit, busy, submitLabel = "Save" }: { title: string; children: ReactNode; onSubmit: () => void; busy: boolean; submitLabel?: string }) {
  return (
    <form
      className="bg-surface-3 shadow-surface-2 flex flex-col gap-3 rounded-xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 className="text-subtitle font-medium">{title}</h3>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">{children}</div>
      <div>
        <Button type="submit" size="sm" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

const personOptions = (people: Person[]) => people.map((p) => ({ value: p.id, label: p.name, hint: p.roleLabel }));

function List({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">{children}</ul>;
}

const rowClass = "flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 text-body hover:bg-hover";

// ---------------------------------------------------------------------------
// People costs (§3.1)
// ---------------------------------------------------------------------------

type CostRow = { id: string; userId: string; person: string; effectiveFrom: string; amount: number; notes: string | null };

export function CostsPanel({ people, rows, today }: { people: (Person & { current: number | null })[]; rows: CostRow[]; today: string }) {
  const { act, busy } = useAct();
  const [draft, setDraft] = useState<{ userId: string; effectiveFrom: string; amount: number | null; notes: string }>({ userId: "", effectiveFrom: `${today.slice(0, 7)}-01`, amount: null, notes: "" });
  const missing = people.filter((p) => p.current === null);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>
        Each person&apos;s monthly cost in IDR (salary and benefits, or a freelancer&apos;s fee). A new row from a date replaces the old one from then on; history is kept. Only HR and C-Level can see these numbers.
      </Intro>
      <AddForm
        title="Set a monthly cost"
        busy={busy}
        onSubmit={async () => {
          if (await act(savePersonCost({ userId: draft.userId, effectiveFrom: draft.effectiveFrom, monthlyCostIdr: draft.amount ?? NaN, notes: draft.notes }), "Cost saved")) setDraft({ ...draft, amount: null, notes: "" });
        }}
      >
        <FormField label="Person" htmlFor="c-person" required>
          <SelectField id="c-person" value={draft.userId} onChange={(v) => setDraft({ ...draft, userId: v })} options={personOptions(people)} placeholder="Choose a person" />
        </FormField>
        <FormField label="Effective from" htmlFor="c-from" required>
          <DatePicker id="c-from" value={draft.effectiveFrom} onChange={(v) => setDraft({ ...draft, effectiveFrom: v })} className="w-full" />
        </FormField>
        <FormField label="Monthly cost" htmlFor="c-amount" required>
          <AmountInput id="c-amount" value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} prefix="IDR" decimals={0} />
        </FormField>
        <FormField label="Note" htmlFor="c-notes">
          <Input id="c-notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. Raise after review" />
        </FormField>
      </AddForm>
      {missing.length > 0 && (
        <p className="text-warning text-body">No cost yet for {missing.map((p) => p.name).join(", ")} — the studio margin is incomplete until they have one.</p>
      )}
      {rows.length === 0 ? (
        <EmptyState icon="money" title="No costs yet" description="Add each person's monthly cost to see margins on the C-Level dashboard." fill={false} />
      ) : (
        <List>
          {rows.map((r) => (
            <li key={r.id} className={rowClass}>
              <span className="min-w-40 flex-1 truncate">{r.person}</span>
              <span className="tabular w-28">from {formatDate(r.effectiveFrom)}</span>
              <span className="tabular w-36 text-right">{formatMoney(r.amount, "IDR")}</span>
              <span className="hidden w-40 truncate md:block">{r.notes}</span>
              <RowActions label={`Actions for ${r.person}`} actions={[{ label: "Delete", icon: "delete", destructive: true, onSelect: () => void act(deletePersonCost(r.id), "Deleted") }]} />
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity (§3.2)
// ---------------------------------------------------------------------------

type CapacityRow = { id: string; userId: string; person: string; effectiveFrom: string; weeklyHours: number };
type OverrideRow = { id: string; person: string; start: string; end: string; hours: number; reason: string | null };

export function CapacityPanel({
  people,
  rows,
  overrides,
  today,
  canEdit,
}: {
  people: (Person & { current: number | null })[];
  rows: CapacityRow[];
  overrides: OverrideRow[];
  today: string;
  canEdit: boolean;
}) {
  const { act, busy } = useAct();
  const [cap, setCap] = useState<{ userId: string; effectiveFrom: string; hours: number | null }>({ userId: "", effectiveFrom: `${today.slice(0, 7)}-01`, hours: 40 });
  const [ov, setOv] = useState<{ userId: string; start: string; end: string; hours: number | null; reason: string }>({ userId: "", start: today, end: today, hours: 0, reason: "" });
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>
        Hours per week each person is available — 40 for full-time, less for part-time or freelancers. Leave, sickness or a temporary change goes in as an override for that period. Utilization and capacity ahead are measured against these hours.
      </Intro>
      {canEdit && (
        <AddForm
          title="Set weekly hours"
          busy={busy}
          onSubmit={() => void act(saveCapacity({ userId: cap.userId, effectiveFrom: cap.effectiveFrom, weeklyHours: cap.hours ?? NaN }), "Capacity saved")}
        >
          <FormField label="Person" htmlFor="k-person" required>
            <SelectField id="k-person" value={cap.userId} onChange={(v) => setCap({ ...cap, userId: v })} options={personOptions(people)} placeholder="Choose a person" />
          </FormField>
          <FormField label="Effective from" htmlFor="k-from" required>
            <DatePicker id="k-from" value={cap.effectiveFrom} onChange={(v) => setCap({ ...cap, effectiveFrom: v })} className="w-full" />
          </FormField>
          <FormField label="Hours per week" htmlFor="k-hours" required>
            <AmountInput id="k-hours" value={cap.hours} onChange={(v) => setCap({ ...cap, hours: v })} decimals={1} />
          </FormField>
        </AddForm>
      )}
      <List>
        {people.map((p) => {
          const history = rows.filter((r) => r.userId === p.id);
          return (
            <li key={p.id} className={rowClass}>
              <span className="flex min-w-40 flex-1 flex-col">
                <span className="truncate">{p.name}</span>
                <span className="text-muted-foreground text-caption">{p.roleLabel}</span>
              </span>
              <span className={cn("tabular w-24 text-right", p.current === null && "text-warning")}>{p.current === null ? "Not set" : `${formatNumber(p.current)}h / week`}</span>
              <span className="flex w-56 flex-wrap justify-end gap-x-2">
                {history.slice(0, 3).map((h) => (
                  <span key={h.id} className="flex items-center gap-1">
                    {formatNumber(h.weeklyHours)}h from {formatDate(h.effectiveFrom)}
                    {canEdit && (
                      <button type="button" className="hover:text-destructive" aria-label={`Delete ${h.weeklyHours}h from ${h.effectiveFrom}`} onClick={() => void act(deleteCapacity(h.id), "Deleted")}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </List>

      <h3 className="pt-2 text-subtitle font-medium">Overrides</h3>
      {canEdit && (
        <AddForm
          title="Add an override"
          busy={busy}
          submitLabel="Add"
          onSubmit={async () => {
            if (await act(addCapacityOverride({ userId: ov.userId, periodStart: ov.start, periodEnd: ov.end, availableHours: ov.hours ?? NaN, reason: ov.reason }), "Override added")) setOv({ ...ov, reason: "" });
          }}
        >
          <FormField label="Person" htmlFor="o-person" required>
            <SelectField id="o-person" value={ov.userId} onChange={(v) => setOv({ ...ov, userId: v })} options={personOptions(people)} placeholder="Choose a person" />
          </FormField>
          <FormField label="From" htmlFor="o-start" required>
            <DatePicker id="o-start" value={ov.start} onChange={(v) => setOv({ ...ov, start: v, end: ov.end < v ? v : ov.end })} className="w-full" />
          </FormField>
          <FormField label="To" htmlFor="o-end" required>
            <DatePicker id="o-end" value={ov.end} onChange={(v) => setOv({ ...ov, end: v })} className="w-full" />
          </FormField>
          <FormField label="Available hours" htmlFor="o-hours" required hint="For the whole period. 0 = away.">
            <AmountInput id="o-hours" value={ov.hours} onChange={(v) => setOv({ ...ov, hours: v })} decimals={1} />
          </FormField>
          <FormField label="Reason" htmlFor="o-reason">
            <Input id="o-reason" value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} placeholder="Annual leave" />
          </FormField>
        </AddForm>
      )}
      {overrides.length === 0 ? (
        <p className="text-muted-foreground text-body">No overrides in the last 90 days or ahead.</p>
      ) : (
        <List>
          {overrides.map((o) => (
            <li key={o.id} className={rowClass}>
              <span className="min-w-40 flex-1 truncate">{o.person}</span>
              <span className="tabular w-52">
                {formatDate(o.start)} – {formatDate(o.end)}
              </span>
              <span className="tabular w-16 text-right">{formatNumber(o.hours)}h</span>
              <span className="w-32 truncate">{o.reason}</span>
              {canEdit && <RowActions label={`Actions for ${o.person}`} actions={[{ label: "Delete", icon: "delete", destructive: true, onSelect: () => void act(deleteCapacityOverride(o.id), "Deleted") }]} />}
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilization targets (§3.3)
// ---------------------------------------------------------------------------

export function UtilizationPanel({
  roles,
  overrides,
  people,
  canEdit,
}: {
  roles: { role: "designer_dev" | "pm" | "sales" | "finance" | "hr"; label: string; target: number }[];
  overrides: { userId: string; person: string; target: number }[];
  people: Person[];
  canEdit: boolean;
}) {
  const { act, busy } = useAct();
  const [targets, setTargets] = useState(roles);
  const [person, setPerson] = useState<{ userId: string; target: number | null }>({ userId: "", target: null });
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>The share of available hours each role should spend on billable work. A person can have their own target. C-Level isn&apos;t counted.</Intro>
      <div className="bg-surface-3 shadow-surface-2 flex flex-col gap-3 rounded-xl p-4">
        <h3 className="text-subtitle font-medium">Target per role</h3>
        <div className="grid gap-3 sm:grid-cols-5">
          {targets.map((t, i) => (
            <FormField key={t.role} label={t.label} htmlFor={`t-${t.role}`}>
              <AmountInput
                id={`t-${t.role}`}
                value={t.target}
                disabled={!canEdit}
                decimals={0}
                prefix="%"
                onChange={(v) => setTargets(targets.map((x, j) => (j === i ? { ...x, target: v ?? 0 } : x)))}
              />
            </FormField>
          ))}
        </div>
        {canEdit && (
          <div>
            <Button size="sm" disabled={busy} onClick={() => void act(saveRoleTargets({ targets: targets.map((t) => ({ role: t.role, targetPercent: t.target })) }), "Targets saved")}>
              Save targets
            </Button>
          </div>
        )}
      </div>
      {canEdit && (
        <AddForm title="Set a person's own target" busy={busy} onSubmit={() => void act(setPersonTarget({ userId: person.userId, targetPercent: person.target ?? NaN }), "Target saved")}>
          <FormField label="Person" htmlFor="p-person" required>
            <SelectField id="p-person" value={person.userId} onChange={(v) => setPerson({ ...person, userId: v })} options={personOptions(people)} placeholder="Choose a person" />
          </FormField>
          <FormField label="Target" htmlFor="p-target" required>
            <AmountInput id="p-target" value={person.target} onChange={(v) => setPerson({ ...person, target: v })} decimals={0} prefix="%" />
          </FormField>
        </AddForm>
      )}
      {overrides.length > 0 && (
        <List>
          {overrides.map((o) => (
            <li key={o.userId} className={rowClass}>
              <span className="flex-1 truncate">{o.person}</span>
              <span className="tabular w-16 text-right">{formatPercent(o.target)}</span>
              {canEdit && <RowActions label={`Actions for ${o.person}`} actions={[{ label: "Use the role's target", icon: "restore", onSelect: () => void act(setPersonTarget({ userId: o.userId, targetPercent: null }), "Back to the role's target") }]} />}
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue targets (§3.4)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RevenuePanel({ year, years, yearly: initialYearly, months: initialMonths }: { year: number; years: number[]; yearly: number | null; months: (number | null)[] }) {
  const { act, busy } = useAct();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [yearly, setYearly] = useState(initialYearly);
  const [months, setMonths] = useState(initialMonths);
  const fallback = yearly !== null ? yearly / 12 : null;
  const sum = months.reduce<number>((s, m) => s + (m ?? fallback ?? 0), 0);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>Revenue targets in IDR. A month without its own target uses the yearly target ÷ 12; quarters and year-to-date add up the months.</Intro>
      <div className="flex items-center gap-2">
        <PillSelect
          ariaLabel="Year"
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(y) => {
            const next = new URLSearchParams(params.toString());
            next.set("year", y);
            next.set("tab", "revenue");
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
          }}
        />
      </div>
      <div className="bg-surface-3 shadow-surface-2 flex flex-col gap-4 rounded-xl p-4">
        <FormField label={`Yearly target ${year}`} htmlFor="r-year" className="max-w-xs">
          <AmountInput id="r-year" value={yearly} onChange={setYearly} prefix="IDR" decimals={0} />
        </FormField>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {months.map((m, i) => (
            <FormField key={i} label={MONTHS[i]!} htmlFor={`r-m${i}`}>
              <AmountInput
                id={`r-m${i}`}
                value={m}
                onChange={(v) => setMonths(months.map((x, j) => (j === i ? v : x)))}
                decimals={0}
                placeholder={fallback !== null ? formatNumber(Math.round(fallback)) : "—"}
              />
            </FormField>
          ))}
        </div>
        <p className="text-muted-foreground text-caption">
          Months add up to <span className="tabular">{formatMoney(sum, "IDR")}</span>
          {yearly !== null && Math.round(sum) !== Math.round(yearly) && <> — the yearly target is {formatMoney(yearly, "IDR")}</>}. Leave a month empty to use the yearly ÷ 12.
        </p>
        <div>
          <Button size="sm" disabled={busy} onClick={() => void act(saveRevenueTargets({ year, yearly, months }), "Targets saved")}>
            Save {year}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FX reference rates (§3.6)
// ---------------------------------------------------------------------------

export function FxPanel({ rows, today, currencies }: { rows: { id: string; currency: string; rate: number; effectiveFrom: string }[]; today: string; currencies: string[] }) {
  const { act, busy } = useAct();
  const [draft, setDraft] = useState<{ currency: string; rate: number | null; effectiveFrom: string }>({ currency: currencies[0] ?? "USD", rate: null, effectiveFrom: today });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.currency) && r.effectiveFrom <= today) latest.set(r.currency, r.id);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>
        Used only to estimate IDR for money not received yet (receivables, forecast) in a foreign currency. Received money always uses what Xendit settled. Without a rate, the last payment&apos;s rate in that currency is used.
      </Intro>
      <AddForm title="Add a rate" busy={busy} onSubmit={() => void act(saveFxRate({ currency: draft.currency, rateToIdr: draft.rate ?? NaN, effectiveFrom: draft.effectiveFrom }), "Rate saved")}>
        <FormField label="Currency" htmlFor="f-cur" required>
          <SelectField id="f-cur" value={draft.currency} onChange={(v) => setDraft({ ...draft, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} />
        </FormField>
        <FormField label={`IDR per 1 ${draft.currency}`} htmlFor="f-rate" required>
          <AmountInput id="f-rate" value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: v })} decimals={2} prefix="IDR" />
        </FormField>
        <FormField label="Effective from" htmlFor="f-from" required>
          <DatePicker id="f-from" value={draft.effectiveFrom} onChange={(v) => setDraft({ ...draft, effectiveFrom: v })} className="w-full" />
        </FormField>
      </AddForm>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-body">No reference rates yet.</p>
      ) : (
        <List>
          {rows.map((r) => (
            <li key={r.id} className={rowClass}>
              <span className="w-12 font-medium">{r.currency}</span>
              <span className="tabular flex-1">{formatMoney(r.rate, "IDR")}</span>
              <span className="tabular w-32">from {formatDate(r.effectiveFrom)}</span>
              <span className="w-20">{latest.get(r.currency) === r.id && <StatusBadge value="active" label="In use" />}</span>
              <RowActions label={`Actions for ${r.currency}`} actions={[{ label: "Delete", icon: "delete", destructive: true, onSelect: () => void act(deleteFxRate(r.id), "Deleted") }]} />
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard rules (§3.8, §2.4)
// ---------------------------------------------------------------------------

type Thresholds = { good: number; watch: number; concentration: number; utilizationBand: number };

const RULES: { key: keyof AttentionRules; label: string; unit: string }[] = [
  { key: "budgetPct", label: "Hour budget used is over", unit: "%" },
  { key: "overdueTasks", label: "Overdue tasks are more than", unit: "tasks" },
  { key: "lateInvoiceDays", label: "A payment is late more than", unit: "days" },
  { key: "marginPct", label: "Project margin is below (when cost data exists)", unit: "%" },
];

export function RulesPanel({ rules: initialRules, thresholds: initialThresholds }: { rules: AttentionRules; thresholds: Thresholds }) {
  const { act, busy } = useAct();
  const [rules, setRules] = useState(initialRules);
  const [t, setT] = useState(initialThresholds);
  const num = (k: keyof Thresholds, label: string, hint?: string) => (
    <FormField label={label} htmlFor={`th-${k}`} hint={hint}>
      <AmountInput id={`th-${k}`} value={t[k]} onChange={(v) => setT({ ...t, [k]: v ?? 0 })} decimals={0} />
    </FormField>
  );
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Intro>When an active project needs C-Level attention, and how numbers with a target are rated.</Intro>
      <div className="bg-surface-3 shadow-surface-2 flex flex-col gap-1 rounded-xl p-4">
        <h3 className="mb-2 text-subtitle font-medium">Project needs attention when…</h3>
        {RULES.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-3 py-1.5 text-body">
            <Switch
              label={r.label}
              className="min-w-64 flex-1 px-0"
              checked={rules[r.key].enabled}
              onToggle={() => setRules({ ...rules, [r.key]: { ...rules[r.key], enabled: !rules[r.key].enabled } })}
            />
            <AmountInput
              aria-label={r.label}
              className="w-28"
              value={rules[r.key].value}
              disabled={!rules[r.key].enabled}
              decimals={0}
              onChange={(v) => setRules({ ...rules, [r.key]: { ...rules[r.key], value: v ?? 0 } })}
            />
            <span className="text-muted-foreground w-12 text-caption">{r.unit}</span>
          </div>
        ))}
      </div>
      <div className="bg-surface-3 shadow-surface-2 flex flex-col gap-3 rounded-xl p-4">
        <h3 className="text-subtitle font-medium">Thresholds</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {num("good", "Good from (% of target)")}
          {num("watch", "Watch from (% of target)", "Below this is Behind.")}
          {num("concentration", "Client concentration warning (%)", "When one client brings more than this share of revenue.")}
          {num("utilizationBand", "Utilization band (± points)", "Overload above target + band, under below target − band.")}
        </div>
      </div>
      <div>
        <Button size="sm" disabled={busy} onClick={() => void act(saveDashboardRules({ rules, thresholds: t }), "Rules saved")}>
          Save rules
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change history (§7: who, when, old value, new value)
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<string, string> = {
  person_cost: "People cost",
  person_capacity: "Capacity",
  capacity_override: "Capacity override",
  utilization_targets: "Role targets",
  utilization_override: "Personal target",
  revenue_targets: "Revenue targets",
  fx_reference_rate: "FX rate",
  dashboard_rules: "Dashboard rules",
};

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? formatNumber(v) : typeof v === "object" ? JSON.stringify(v) : String(v));

export function HistoryPanel({ rows, timezone }: { rows: { id: string; at: string; actor: string; type: string; action: string; metadata: Record<string, unknown> | null; person: string | null }[]; timezone: string }) {
  if (rows.length === 0) return <EmptyState icon="activity" title="No changes yet" description="Every change to the data on this page is recorded here." fill={false} />;
  return (
    <List>
      {rows.map((r) => (
        <li key={r.id} className={cn(rowClass, "items-start py-2")}>
          <span className="tabular w-36">{formatDateTime(r.at, timezone)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span>
              <span className="font-medium">{r.actor}</span> {r.action} {TYPE_LABEL[r.type] ?? r.type}
              {r.person && <span> · {r.person}</span>}
            </span>
            {r.metadata && ("before" in r.metadata || "after" in r.metadata) && (
              <span className="text-muted-foreground truncate text-caption" title={`${show(r.metadata.before)} → ${show(r.metadata.after)}`}>
                {show(r.metadata.before)} → {show(r.metadata.after)}
              </span>
            )}
          </span>
        </li>
      ))}
    </List>
  );
}
