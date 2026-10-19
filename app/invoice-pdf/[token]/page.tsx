import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redeemPdfToken } from "@/lib/invoices/pdf";
import { getInvoiceDocument } from "@/lib/invoices/queries";
import { InvoiceDocument, InvoicePrintStyles } from "@/components/invoice/invoice-document";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Bare paper for headless Chrome (lib/invoices/pdf.ts). The short-lived signed token is the only way in. */
export default async function InvoicePdfPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const grant = redeemPdfToken(token);
  if (!grant) notFound();
  const invoice = await getInvoiceDocument(grant.invoiceId);
  if (!invoice) notFound();
  return (
    <>
      <InvoicePrintStyles />
      <InvoiceDocument invoice={invoice} />
    </>
  );
}
