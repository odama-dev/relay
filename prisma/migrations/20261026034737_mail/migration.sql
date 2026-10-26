-- CreateEnum
CREATE TYPE "mail_direction" AS ENUM ('inbound', 'outbound');

-- CreateTable
CREATE TABLE "mail_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL DEFAULT 993,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL DEFAULT 465,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "password_enc" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "last_synced_at" TIMESTAMPTZ,
    "sync_state" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "message_id" TEXT NOT NULL,
    "direction" "mail_direction" NOT NULL,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT,
    "to_emails" TEXT[],
    "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "person_id" UUID,
    "company_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_user_id_email_key" ON "mail_accounts"("user_id", "email");

-- CreateIndex
CREATE INDEX "mail_messages_account_id_sent_at_idx" ON "mail_messages"("account_id", "sent_at");

-- CreateIndex
CREATE INDEX "mail_messages_person_id_sent_at_idx" ON "mail_messages"("person_id", "sent_at");

-- CreateIndex
CREATE INDEX "mail_messages_company_id_sent_at_idx" ON "mail_messages"("company_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_account_id_message_id_key" ON "mail_messages"("account_id", "message_id");

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Mail (Sales feedback, Oct 2026): anyone connects their own mailboxes on any
-- domain over IMAP + SMTP. The owner manages the account and sees all of its
-- mail; messages linked to a CRM person or company are visible to the Sales
-- team (Sales / Studio Report) unless the owner turned sharing off. Messages
-- are written by the system only (sync job, send action).
-- ===========================================================================
ALTER TABLE public.mail_accounts
  ADD CONSTRAINT mail_accounts_email CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD CONSTRAINT mail_accounts_ports CHECK (imap_port BETWEEN 1 AND 65535 AND smtp_port BETWEEN 1 AND 65535),
  ADD CONSTRAINT mail_accounts_sync_state CHECK (jsonb_typeof(sync_state) = 'object');

CREATE OR REPLACE FUNCTION app.mail_accounts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := app.uid();
    NEW.sync_state := '{}';
    NEW.last_synced_at := NULL;
    NEW.last_error := NULL;
  ELSIF NEW.user_id <> OLD.user_id OR NEW.sync_state <> OLD.sync_state OR NEW.last_synced_at IS DISTINCT FROM OLD.last_synced_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'These mailbox fields are managed by the system' USING ERRCODE = '42501';
  END IF;
  -- A new address starts a fresh sync.
  IF TG_OP = 'UPDATE' AND (NEW.email <> OLD.email OR NEW.imap_host <> OLD.imap_host OR NEW.username <> OLD.username) THEN
    RAISE EXCEPTION 'Connect a new mailbox instead of changing its address' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER mail_accounts_guard BEFORE INSERT OR UPDATE ON public.mail_accounts
  FOR EACH ROW EXECUTE FUNCTION app.mail_accounts_guard();

CREATE OR REPLACE FUNCTION app.owns_mail_account(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL AND EXISTS (SELECT 1 FROM public.mail_accounts a WHERE a.id = aid AND a.user_id = app.uid())
$$;

CREATE OR REPLACE FUNCTION app.mail_account_shared(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mail_accounts a WHERE a.id = aid AND a.shared AND a.is_active)
$$;

ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_accounts, public.mail_messages FROM anon, authenticated;
-- The encrypted password can be written by its owner but never read back.
GRANT SELECT (id, user_id, email, display_name, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username,
              shared, is_active, last_error, last_synced_at, sync_state, created_at, updated_at)
  ON public.mail_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.mail_accounts TO authenticated;
GRANT SELECT ON public.mail_messages TO authenticated;

CREATE POLICY mail_accounts_select ON public.mail_accounts FOR SELECT TO authenticated USING (user_id = app.uid() AND app.user_role() IS NOT NULL);
CREATE POLICY mail_accounts_insert ON public.mail_accounts FOR INSERT TO authenticated WITH CHECK (app.user_role() IS NOT NULL);
CREATE POLICY mail_accounts_update ON public.mail_accounts FOR UPDATE TO authenticated
  USING (user_id = app.uid() AND app.user_role() IS NOT NULL) WITH CHECK (user_id = app.uid());
CREATE POLICY mail_accounts_delete ON public.mail_accounts FOR DELETE TO authenticated USING (user_id = app.uid() AND app.user_role() IS NOT NULL);

CREATE POLICY mail_messages_select ON public.mail_messages FOR SELECT TO authenticated
  USING (
    app.owns_mail_account(account_id)
    OR (
      (person_id IS NOT NULL OR company_id IS NOT NULL)
      AND app.has_module('sales', 'studio_report')
      AND app.mail_account_shared(account_id)
    )
  );

GRANT EXECUTE ON FUNCTION app.owns_mail_account(uuid), app.mail_account_shared(uuid) TO authenticated, service_role;
