-- CreateEnum
CREATE TYPE "stage_category" AS ENUM ('open', 'won', 'lost');

-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('dp', 'term', 'final');

-- CreateEnum
CREATE TYPE "payment_platform" AS ENUM ('xendit', 'bank_transfer', 'wise', 'paypal', 'other');

-- CreateEnum
CREATE TYPE "payment_proof_status" AS ENUM ('submitted', 'verified', 'rejected');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "fx_rate_at_issue" DECIMAL(18,6),
ADD COLUMN     "kind" "invoice_kind",
ADD COLUMN     "platform" "payment_platform" NOT NULL DEFAULT 'xendit';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'xendit';

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "stage_category" NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "client_id" UUID,
    "prospect_name" TEXT,
    "value" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expected_close" DATE,
    "owner_id" UUID,
    "lead_source" TEXT,
    "service_type" TEXT,
    "lost_reason" TEXT,
    "notes" TEXT,
    "stage_id" UUID NOT NULL,
    "stage_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "project_id" UUID,
    "external_id" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_history" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_snapshots" (
    "date" DATE NOT NULL,
    "open_idr" DECIMAL(18,2) NOT NULL,
    "weighted_idr" DECIMAL(18,2) NOT NULL,
    "open_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_snapshots_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "payment_request_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "platform" "payment_platform" NOT NULL,
    "file_path" TEXT,
    "file_name" TEXT,
    "note" TEXT,
    "fx_rate_to_idr" DECIMAL(18,6),
    "status" "payment_proof_status" NOT NULL DEFAULT 'submitted',
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "payment_id" UUID,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deals_project_id_key" ON "deals"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_external_id_key" ON "deals"("external_id");

-- CreateIndex
CREATE INDEX "deals_stage_id_idx" ON "deals"("stage_id");

-- CreateIndex
CREATE INDEX "deals_owner_id_idx" ON "deals"("owner_id");

-- CreateIndex
CREATE INDEX "deal_stage_history_deal_id_changed_at_idx" ON "deal_stage_history"("deal_id", "changed_at");

-- CreateIndex
CREATE INDEX "deal_stage_history_changed_at_idx" ON "deal_stage_history"("changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proofs_payment_id_key" ON "payment_proofs"("payment_id");

-- CreateIndex
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs"("status");

-- CreateIndex
CREATE INDEX "payment_proofs_invoice_id_idx" ON "payment_proofs"("invoice_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "invoice_payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ===========================================================================
-- Phase 2 · M9 Sales — Row Level Security (module-based). Guards and the
-- verification flow follow in the next M9 migration.
-- ===========================================================================
ALTER TABLE public.pipeline_stages ADD CONSTRAINT pipeline_stages_probability CHECK (probability BETWEEN 0 AND 100);
ALTER TABLE public.deals ADD CONSTRAINT deals_probability CHECK (probability BETWEEN 0 AND 100),
  ADD CONSTRAINT deals_value CHECK (value >= 0),
  ADD CONSTRAINT deals_party CHECK (client_id IS NOT NULL OR prospect_name IS NOT NULL);
ALTER TABLE public.payment_proofs ADD CONSTRAINT payment_proofs_amount CHECK (amount > 0);

INSERT INTO public.pipeline_stages (id, name, category, probability, position) VALUES
  (gen_random_uuid(), 'Lead', 'open', 10, 0),
  (gen_random_uuid(), 'Qualified', 'open', 25, 1),
  (gen_random_uuid(), 'Proposal sent', 'open', 50, 2),
  (gen_random_uuid(), 'Negotiation', 'open', 75, 3),
  (gen_random_uuid(), 'Won', 'won', 100, 4),
  (gen_random_uuid(), 'Lost', 'lost', 0, 5);

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_stages, public.deals, public.deal_stage_history, public.pipeline_snapshots, public.payment_proofs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages, public.deals TO authenticated;
GRANT SELECT, INSERT ON public.deal_stage_history TO authenticated;
GRANT SELECT ON public.pipeline_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_proofs TO authenticated;

CREATE POLICY pipeline_stages_select ON public.pipeline_stages FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY pipeline_stages_write ON public.pipeline_stages FOR ALL TO authenticated USING (app.has_module('sales')) WITH CHECK (app.has_module('sales'));
CREATE POLICY deals_select ON public.deals FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY deals_write ON public.deals FOR ALL TO authenticated USING (app.has_module('sales')) WITH CHECK (app.has_module('sales'));
CREATE POLICY deal_stage_history_select ON public.deal_stage_history FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY deal_stage_history_insert ON public.deal_stage_history FOR INSERT TO authenticated WITH CHECK (app.has_module('sales'));
CREATE POLICY pipeline_snapshots_select ON public.pipeline_snapshots FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY payment_proofs_select ON public.payment_proofs FOR SELECT TO authenticated USING (app.has_module('sales', 'finance', 'studio_report'));
CREATE POLICY payment_proofs_insert ON public.payment_proofs FOR INSERT TO authenticated WITH CHECK (app.has_module('sales') AND submitted_by = app.uid());
CREATE POLICY payment_proofs_update ON public.payment_proofs FOR UPDATE TO authenticated USING (app.has_module('finance')) WITH CHECK (app.has_module('finance'));
