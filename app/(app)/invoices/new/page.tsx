import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, asUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { todayIn, addDays } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata = { title: "New invoice" };

/** M5.1 — started from a project or from here; only Active / On hold client projects. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireAccess(perms.editInvoices);
  const { project: projectId } = await searchParams;
  const today = todayIn(user.timezone);

  if (!projectId) {
    const projects = await asUser(user, (tx) =>
      tx.project.findMany({
        where: { kind: "client", status: { in: ["active", "on_hold"] } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, currency: true, client: { select: { name: true } } },
      }),
    );
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <PageHeader title="New invoice" description="Choose the project to invoice. Client, currency and billing details come from it." />
        {projects.length === 0 ? (
          <EmptyState icon="projects" title="No client projects to invoice" description="Invoices are created for Active or On hold client projects." />
        ) : (
          <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/invoices/new?project=${p.id}`} className="hover:bg-hover flex items-center gap-3 rounded-lg px-3 py-2.5 text-body">
                  <span className="tabular w-20">{p.code}</span>
                  <span className="flex-1 truncate [font-variation-settings:'wght'_500,'opsz'_14]">{p.name}</span>
                  <span>{p.client?.name}</span>
                  <span className="w-10 text-right">{p.currency}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const project = await asUser(user, (tx) =>
    tx.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, name: true, kind: true, status: true, currency: true, client: { select: { name: true, billingEmail: true } } } }),
  ).catch(() => null);
  if (!project || project.kind !== "client") notFound();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="New invoice"
        eyebrow={<Link href={`/projects/${project.id}?tab=invoices`} className="text-muted-foreground hover:text-foreground text-caption">{project.code} · {project.name}</Link>}
        description={`Bill to ${project.client?.name}${project.client?.billingEmail ? ` (${project.client.billingEmail})` : ""} · ${project.currency}. Saved as a draft until you send it.`}
      />
      <InvoiceEditor
        projectId={project.id}
        currency={project.currency}
        initial={{
          issueDate: today,
          notes: "",
          kind: null,
          platform: "xendit",
          items: [{ description: "", quantity: 1, unitPrice: null }],
          requests: [
            { label: "Down Payment", percent: 50, amount: null, dueDate: addDays(today, 7) },
            { label: "Final Payment", percent: 50, amount: null, dueDate: addDays(today, 30) },
          ],
        }}
      />
    </div>
  );
}
