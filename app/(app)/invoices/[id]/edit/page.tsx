import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getInvoice } from "@/lib/invoices/queries";
import { PageHeader } from "@/components/page-header";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(perms.editInvoices);
  const { id } = await params;
  const inv = await getInvoice(user, id).catch(() => null);
  if (!inv) notFound();
  if (!inv.viewer.canEdit) redirect(`/invoices/${id}`);
  return (
    <div className="flex flex-col">
      <PageHeader
        title={`Edit ${inv.number ?? "draft"}`}
        eyebrow={<Link href={`/invoices/${id}`} className="text-muted-foreground hover:text-foreground text-caption">{inv.project.code} · {inv.billTo.name}</Link>}
      />
      <InvoiceEditor
        projectId={inv.project.id}
        currency={inv.currency}
        invoiceId={inv.id}
        initial={{
          issueDate: inv.issueDate,
          notes: inv.notes ?? "",
          kind: inv.kind,
          platform: inv.platform,
          items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
          requests: inv.requests.map((r) => ({ label: r.label, amount: r.amount, percent: null, dueDate: r.dueDate })),
        }}
      />
    </div>
  );
}
