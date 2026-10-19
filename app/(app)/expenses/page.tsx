import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { expenseProjectOptions, listExpenses, parseExpenseFilters } from "@/lib/expenses/queries";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_KIND_LABELS, expenseTotals } from "@/lib/expenses/pure";
import { CURRENCIES, EXPENSE_CATEGORIES, EXPENSE_KINDS } from "@/lib/validation";
import { addMonths, monthStart, todayIn } from "@/lib/time/pure";
import { delta } from "@/lib/clevel/pure";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { SummaryStrip } from "@/components/summary-strip";
import { TrendDelta } from "@/components/trend-delta";
import { PeriodFilter } from "@/components/period-filter";
import { EmptyState } from "@/components/states";
import { ExpensesTable } from "./expenses-table";
import { RecordExpenseButton } from "./expense-form-dialog";

export const metadata = { title: "Expenses" };

/** Studio spending — subscriptions, utilities, rent, equipment — recorded by Finance and C-Level. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess(perms.manageExpenses);
  const sp = await searchParams;
  const filters = parseExpenseFilters(sp);
  const today = todayIn(user.timezone);
  const thisMonth = monthStart(today);
  const lastMonth = addMonths(thisMonth, -1);
  const [rows, settings, projects, recent] = await Promise.all([
    listExpenses(user, filters),
    getSettings(),
    expenseProjectOptions(user),
    // This month and last, same type / category / search, any period filter aside.
    listExpenses(user, { ...filters, from: lastMonth, to: today, currency: undefined }),
  ]);
  const currency = CURRENCIES.find((c) => c === settings.base_currency) ?? "IDR";
  // The strip shows the base currency only; other currencies stay in the table.
  const total = expenseTotals(rows).find((t) => t.currency === currency);
  const inBase = recent.filter((r) => r.currency === currency);
  const current = expenseTotals(inBase.filter((r) => r.expenseDate >= thisMonth))[0];
  const previous = expenseTotals(inBase.filter((r) => r.expenseDate < thisMonth))[0];
  const trend = (k: "total" | "opex" | "capex") => (
    <TrendDelta pct={delta(current?.[k] ?? 0, previous?.[k] ?? 0).pct} goodWhenUp={false} />
  );
  const action = <RecordExpenseButton today={today} currency={currency} projects={projects} />;

  return (
    <div className="flex flex-col">
      <PageHeader title="Expenses" compact actions={action} />
      {rows.length === 0 && !Object.keys(sp).length ? (
        <EmptyState
          icon="wallet"
          title="No expenses yet"
          description="Record subscriptions, utility bills, rent and equipment as they're paid. Attach the receipt to keep everything in one place."
          action={action}
        />
      ) : (
        <>
          <SummaryStrip
            items={[
              { label: "Total", values: [formatMoney(total?.total ?? 0, currency)], delta: trend("total") },
              { label: "Opex", values: [formatMoney(total?.opex ?? 0, currency)], delta: trend("opex") },
              { label: "Capex", values: [formatMoney(total?.capex ?? 0, currency)], delta: trend("capex") },
            ]}
          />
          <FilterBar
            searchPlaceholder="Search vendor, description or notes"
            filters={[
              { param: "kind", label: "Type", allLabel: "Opex & capex", options: EXPENSE_KINDS.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] })) },
              { param: "category", label: "Category", allLabel: "All categories", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] })) },
              { param: "currency", label: "Currency", allLabel: "All currencies", options: CURRENCIES.map((c) => ({ value: c, label: c })) },
            ]}
            actions={<PeriodFilter from={filters.from} to={filters.to} label="Expense date period" placeholder="Any date" />}
          />
          <ExpensesTable rows={rows} today={today} currency={currency} projects={projects} />
        </>
      )}
    </div>
  );
}
