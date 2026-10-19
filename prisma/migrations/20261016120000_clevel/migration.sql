-- C-Level dashboard inputs (PRD/Clevel dashboard.md §3). Tables first, then access rules.


-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "project_id" UUID;

-- AlterTable
ALTER TABLE "project_contracts" ADD COLUMN     "retainer_fee_per_month" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "person_costs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "monthly_cost_idr" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_capacity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "weekly_hours" DECIMAL(6,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacity_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "available_hours" DECIMAL(8,2) NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capacity_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilization_targets" (
    "role" "user_role" NOT NULL,
    "target_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utilization_targets_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "utilization_overrides" (
    "user_id" UUID NOT NULL,
    "target_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utilization_overrides_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "revenue_targets" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "target_idr" DECIMAL(18,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_reference_rates" (
    "id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "rate_to_idr" DECIMAL(18,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_reference_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_costs_user_id_effective_from_key" ON "person_costs"("user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "person_capacity_user_id_effective_from_key" ON "person_capacity"("user_id", "effective_from");

-- CreateIndex
CREATE INDEX "capacity_overrides_user_id_period_start_idx" ON "capacity_overrides"("user_id", "period_start");

-- CreateIndex
-- One yearly row (month NULL) per year: NULLS NOT DISTINCT.
CREATE UNIQUE INDEX "revenue_targets_year_month_key" ON "revenue_targets"("year", "month") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "fx_reference_rates_currency_effective_from_key" ON "fx_reference_rates"("currency", "effective_from");

-- CreateIndex
CREATE INDEX "expenses_project_id_idx" ON "expenses"("project_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_costs" ADD CONSTRAINT "person_costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_capacity" ADD CONSTRAINT "person_capacity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacity_overrides" ADD CONSTRAINT "capacity_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilization_overrides" ADD CONSTRAINT "utilization_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
ALTER TABLE public.person_costs ADD CONSTRAINT person_costs_amount CHECK (monthly_cost_idr >= 0);
ALTER TABLE public.person_capacity ADD CONSTRAINT person_capacity_hours CHECK (weekly_hours >= 0 AND weekly_hours <= 168);
ALTER TABLE public.capacity_overrides
  ADD CONSTRAINT capacity_overrides_range CHECK (period_end >= period_start),
  ADD CONSTRAINT capacity_overrides_hours CHECK (available_hours >= 0);
ALTER TABLE public.utilization_targets ADD CONSTRAINT utilization_targets_pct CHECK (target_percent >= 0 AND target_percent <= 100);
ALTER TABLE public.utilization_overrides ADD CONSTRAINT utilization_overrides_pct CHECK (target_percent >= 0 AND target_percent <= 100);
ALTER TABLE public.revenue_targets
  ADD CONSTRAINT revenue_targets_month CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  ADD CONSTRAINT revenue_targets_amount CHECK (target_idr >= 0);
ALTER TABLE public.fx_reference_rates
  ADD CONSTRAINT fx_reference_rates_rate CHECK (rate_to_idr > 0),
  ADD CONSTRAINT fx_reference_rates_iso CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'IDR');
ALTER TABLE public.project_contracts ADD CONSTRAINT project_contracts_retainer_fee CHECK (retainer_fee_per_month IS NULL OR retainer_fee_per_month >= 0);

-- ---------------------------------------------------------------------------
-- Row Level Security (§2.1, §7). Cost data — person_costs and everything
-- derived from it — is HR and C-Level only; Finance included in "nobody else".
-- ---------------------------------------------------------------------------
ALTER TABLE public.person_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utilization_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utilization_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_reference_rates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.person_costs, public.person_capacity, public.capacity_overrides, public.utilization_targets,
  public.utilization_overrides, public.revenue_targets, public.fx_reference_rates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_costs, public.person_capacity, public.capacity_overrides,
  public.utilization_targets, public.utilization_overrides, public.revenue_targets, public.fx_reference_rates TO authenticated;

-- Biaya orang — HR and C-Level read and write.
CREATE POLICY person_costs_all ON public.person_costs FOR ALL TO authenticated
  USING (app.has_role('hr', 'c_level')) WITH CHECK (app.has_role('hr', 'c_level'));

-- Kapasitas — HR writes; HR, C-Level and PM read (no cost in these tables).
-- Admins may also write, so a studio without HR can still set it up.
CREATE POLICY person_capacity_select ON public.person_capacity FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level', 'pm') OR app.is_admin());
CREATE POLICY person_capacity_write ON public.person_capacity FOR ALL TO authenticated
  USING (app.has_role('hr') OR app.is_admin()) WITH CHECK (app.has_role('hr') OR app.is_admin());
CREATE POLICY capacity_overrides_select ON public.capacity_overrides FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level', 'pm') OR app.is_admin());
CREATE POLICY capacity_overrides_write ON public.capacity_overrides FOR ALL TO authenticated
  USING (app.has_role('hr') OR app.is_admin()) WITH CHECK (app.has_role('hr') OR app.is_admin());

-- Target utilization — HR writes; HR and C-Level read.
CREATE POLICY utilization_targets_select ON public.utilization_targets FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level') OR app.is_admin());
CREATE POLICY utilization_targets_write ON public.utilization_targets FOR ALL TO authenticated
  USING (app.has_role('hr') OR app.is_admin()) WITH CHECK (app.has_role('hr') OR app.is_admin());
CREATE POLICY utilization_overrides_select ON public.utilization_overrides FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level') OR app.is_admin());
CREATE POLICY utilization_overrides_write ON public.utilization_overrides FOR ALL TO authenticated
  USING (app.has_role('hr') OR app.is_admin()) WITH CHECK (app.has_role('hr') OR app.is_admin());

-- Target revenue — C-Level only.
CREATE POLICY revenue_targets_all ON public.revenue_targets FOR ALL TO authenticated
  USING (app.has_role('c_level')) WITH CHECK (app.has_role('c_level'));

-- Kurs referensi — Finance and C-Level.
CREATE POLICY fx_reference_rates_all ON public.fx_reference_rates FOR ALL TO authenticated
  USING (app.has_role('finance', 'c_level')) WITH CHECK (app.has_role('finance', 'c_level'));

-- Aturan dashboard (§3.8, §2.4) — C-Level may write these settings keys, besides admins.
CREATE POLICY app_settings_write_dashboard ON public.app_settings FOR ALL TO authenticated
  USING (app.has_role('c_level') AND key IN ('project_attention_rules', 'clevel_dashboard_thresholds'))
  WITH CHECK (app.has_role('c_level') AND key IN ('project_attention_rules', 'clevel_dashboard_thresholds'));

-- ---------------------------------------------------------------------------
-- Defaults (§3.3)
-- ---------------------------------------------------------------------------
INSERT INTO public.utilization_targets (role, target_percent, updated_at) VALUES
  ('designer_dev', 80, now()), ('pm', 50, now()), ('sales', 30, now()), ('finance', 20, now()), ('hr', 20, now())
ON CONFLICT (role) DO NOTHING;
