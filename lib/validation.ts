import { z } from "zod";
import { EMPLOYMENT_TYPES, USER_ROLES } from "@/lib/roles";
import { isIsoDate } from "@/lib/time/pure";

/**
 * Shared Zod schemas — imported by client forms and server actions so each
 * rule is written once. Calendar dates travel as "yyyy-mm-dd" strings (never
 * Date objects) so no time zone can shift them.
 */

export const CURRENCIES = ["IDR", "USD", "EUR", "SGD", "AUD"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const PROJECT_STATUSES = ["active", "on_hold", "completed", "archived"] as const;
export const CONTRACT_TYPES = ["retainer", "fixed", "time_and_material"] as const;
export const ROLLOVER_MODES = ["none", "full", "capped"] as const;

const text = (max = 2000) => z.string().trim().max(max);
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const uuid = z.string().uuid("Not found");
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().uuid().optional());

export const isoDate = z.string().refine(isIsoDate, "Enter a valid date");
const optionalIsoDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(isoDate.optional());

const email = z.string().trim().toLowerCase().email("Enter a valid email");
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().email("Enter a valid email").optional());

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().url("Enter a valid URL").optional());

const hours = z.number({ error: "Enter hours" }).finite().min(0, "Must be zero or more").max(100_000);
const optionalHours = hours.nullable().optional().transform((v) => (v == null ? null : v));
const amount = z.number({ error: "Enter an amount" }).finite().min(0, "Must be zero or more").max(1_000_000_000_000);

// ---------------------------------------------------------------------------
// M0 — auth, people, settings
// ---------------------------------------------------------------------------

export const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
export type PasswordInput = z.infer<typeof passwordSchema>;

export const inviteSchema = z.object({
  fullName: text(120).min(1, "Enter a name"),
  email,
  role: z.enum(USER_ROLES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  isAdmin: z.boolean().default(false),
});
export type InviteInput = z.input<typeof inviteSchema>;

export const ownProfileSchema = z.object({
  fullName: text(120).min(1, "Enter your name"),
  avatarUrl: optionalUrl,
  timezone: text(64).min(1),
  mutedNotifications: z.array(z.string()).max(50).default([]),
});
export type OwnProfileInput = z.input<typeof ownProfileSchema>;

export const personAdminSchema = z.object({
  fullName: text(120).min(1, "Enter a name"),
  role: z.enum(USER_ROLES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  isAdmin: z.boolean(),
});
export type PersonAdminInput = z.input<typeof personAdminSchema>;

const thresholds = z
  .array(z.number().int().min(1, "Use 1–500%").max(500, "Use 1–500%"))
  .min(1, "Add at least one threshold")
  .max(6, "Up to six thresholds");

export const settingsFormSchema = z.object({
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  workdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one workday"),
  default_alert_thresholds: thresholds,
  currencies: z.array(z.enum(CURRENCIES)).min(1, "Keep at least one currency"),
  base_currency: z.enum(CURRENCIES),
  invoice_number_format: text(40).refine((v) => v.includes("{SEQ}"), "Include {SEQ}"),
  invoice_sender_email: email,
  invoice_sender_name: text(120).min(1, "Enter a sender name"),
  studio_name: text(120).min(1, "Enter the studio name"),
  studio_address: text(500),
  studio_email: z.string().trim().max(200),
  studio_website: z.string().trim().max(200),
});
export type SettingsFormInput = z.input<typeof settingsFormSchema>;

export const categorySchema = z.object({ name: text(60).min(1, "Enter a name") });

// ---------------------------------------------------------------------------
// M1 — clients & projects
// ---------------------------------------------------------------------------

export const clientCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,6}$/, "2–6 capital letters, e.g. ACME")
  .refine((v) => v !== "INT", "INT is reserved for internal projects");

export const clientSchema = z.object({
  code: clientCodeSchema,
  name: text(160).min(1, "Enter the client name"),
  country: optionalText(80),
  timezone: optionalText(64),
  defaultCurrency: z.enum(CURRENCIES),
  billingEmail: optionalEmail,
  billingAddress: optionalText(500),
  notes: optionalText(4000),
});
export type ClientInput = z.input<typeof clientSchema>;

export const contactSchema = z.object({
  name: text(120).min(1, "Enter a name"),
  email: optionalEmail,
  title: optionalText(120),
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactSchema>;

const links = z.object({
  notion: optionalUrl,
  figma: optionalUrl,
  drive: optionalUrl,
  slack_channel: optionalText(120),
});

export const budgetSchema = z
  .object({
    budgetHours: optionalHours,
    retainerHoursPerMonth: optionalHours,
    rolloverMode: z.enum(ROLLOVER_MODES).default("none"),
    rolloverCapHours: optionalHours,
    alertThresholds: thresholds,
  })
  .refine((v) => v.rolloverMode !== "capped" || (v.rolloverCapHours ?? 0) > 0, {
    message: "Set the rollover cap",
    path: ["rolloverCapHours"],
  });
export type BudgetInput = z.input<typeof budgetSchema>;

export const projectSchema = z
  .object({
    name: text(160).min(1, "Enter the project name"),
    kind: z.enum(["client", "internal"]),
    clientId: optionalUuid,
    contractType: z.enum(CONTRACT_TYPES).optional(),
    currency: z.enum(CURRENCIES),
    contractValue: amount.nullable().optional(),
    /** Retainer projects: monthly fee in the project currency (C-Level forecast). */
    retainerFeePerMonth: amount.nullable().optional(),
    pmId: z.string().uuid("Choose a PM"),
    status: z.enum(PROJECT_STATUSES).default("active"),
    startDate: isoDate,
    endDate: optionalIsoDate,
    links,
    budget: budgetSchema,
  })
  .refine((v) => v.kind === "internal" || v.clientId, { message: "Choose a client", path: ["clientId"] })
  .refine((v) => v.kind === "internal" || v.contractType, { message: "Choose a contract type", path: ["contractType"] })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "Ends before it starts", path: ["endDate"] })
  .refine((v) => v.contractType !== "retainer" || (v.budget.retainerHoursPerMonth ?? 0) > 0, {
    message: "Set the hours per month",
    path: ["budget", "retainerHoursPerMonth"],
  });
export type ProjectInput = z.input<typeof projectSchema>;

// ---------------------------------------------------------------------------
// M2 — tasks
// ---------------------------------------------------------------------------

export const sectionSchema = z.object({ name: text(80).min(1, "Enter a name") });

export const taskSchema = z.object({
  title: text(240).min(1, "Enter a title"),
  sectionId: uuid,
  ownerId: optionalUuid,
  collaboratorIds: z.array(z.string().uuid()).max(30).default([]),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(TASK_STATUSES).default("todo"),
  dueDate: optionalIsoDate,
  estimateHours: optionalHours,
});
export type TaskInput = z.input<typeof taskSchema>;

export const taskPatchSchema = z
  .object({
    title: text(240).min(1, "Enter a title"),
    sectionId: uuid,
    ownerId: z.string().uuid().nullable(),
    collaboratorIds: z.array(z.string().uuid()).max(30),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    dueDate: isoDate.nullable(),
    estimateHours: hours.nullable(),
  })
  .partial();
export type TaskPatch = z.input<typeof taskPatchSchema>;

export const commentSchema = z.object({ text: text(5000).min(1, "Write a comment") });

// ---------------------------------------------------------------------------
// M3 — time
// ---------------------------------------------------------------------------

export const timeEntrySchema = z
  .object({
    entryDate: isoDate,
    minutes: z.number().int().min(1, "Enter a duration").max(24 * 60, "At most 24 hours"),
    taskId: optionalUuid,
    categoryId: optionalUuid,
    note: optionalText(1000),
    outOfScope: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.taskId) !== Boolean(v.categoryId), { message: "Choose a task or a category", path: ["taskId"] })
  .refine((v) => !v.outOfScope || Boolean(v.note), { message: "Describe what was asked outside the scope", path: ["note"] });
export type TimeEntryInput = z.input<typeof timeEntrySchema>;

export const correctionSchema = z
  .object({
    timeEntryId: optionalUuid,
    delete: z.boolean().default(false),
    entryDate: isoDate,
    minutes: z.number().int().min(1).max(24 * 60),
    taskId: optionalUuid,
    categoryId: optionalUuid,
    note: optionalText(1000),
    reason: text(1000).min(3, "Explain why"),
  })
  .refine((v) => v.delete || Boolean(v.taskId) !== Boolean(v.categoryId), {
    message: "Choose a task or a category",
    path: ["taskId"],
  });
export type CorrectionInput = z.input<typeof correctionSchema>;

export const reviewSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  decision: z.enum(["approved", "rejected"]),
  note: optionalText(1000),
});

// ---------------------------------------------------------------------------
// M5 — invoices
// ---------------------------------------------------------------------------

export const invoiceItemSchema = z.object({
  description: text(500).min(1, "Describe the item"),
  quantity: z.number({ error: "Enter a quantity" }).finite().gt(0, "More than zero").max(1_000_000),
  unitPrice: amount,
});

export const paymentRequestSchema = z.object({
  label: text(80).min(1, "Label it, e.g. Down Payment"),
  amount: z.number({ error: "Enter an amount" }).finite().gt(0, "More than zero"),
  dueDate: isoDate,
});

export const invoiceSchema = z.object({
  projectId: uuid,
  issueDate: isoDate,
  notes: optionalText(2000),
  items: z.array(invoiceItemSchema).min(1, "Add at least one item").max(100),
  requests: z.array(paymentRequestSchema).min(1, "Add at least one payment request").max(12),
});
export type InvoiceInput = z.input<typeof invoiceSchema>;

export const sendInvoiceSchema = z.object({
  to: z.array(email).min(1, "Add a recipient").max(10),
  cc: z.array(email).max(10).default([]),
  subject: text(200).min(1, "Enter a subject"),
  message: text(4000),
});
export type SendInvoiceInput = z.input<typeof sendInvoiceSchema>;

// ---------------------------------------------------------------------------
// Expenses — studio spending recorded by Finance / C-Level
// ---------------------------------------------------------------------------

export const EXPENSE_KINDS = ["opex", "capex"] as const;
export const EXPENSE_CATEGORIES = ["software", "utilities", "rent", "internet", "equipment", "marketing", "professional_services", "travel", "other"] as const;

export const expenseSchema = z.object({
  expenseDate: isoDate,
  vendor: text(120).min(1, "Enter the vendor"),
  description: optionalText(300),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Pick a category" }),
  kind: z.enum(EXPENSE_KINDS, { error: "Pick opex or capex" }),
  amount: z.number({ error: "Enter an amount" }).finite().gt(0, "More than zero").max(1_000_000_000_000),
  currency: z.enum(CURRENCIES),
  notes: optionalText(2000),
  /** A cost tied to one project (e.g. a freelancer) — counted in its margin. */
  projectId: optionalUuid,
});
export type ExpenseInput = z.input<typeof expenseSchema>;

// ---------------------------------------------------------------------------
// C-Level dashboard inputs (PRD/Clevel dashboard.md §3, §7)
// ---------------------------------------------------------------------------

const percent = z.number({ error: "Enter a percentage" }).finite().min(0, "0 or more").max(100, "100 at most");

export const personCostSchema = z.object({
  userId: z.string().uuid("Choose a person"),
  effectiveFrom: isoDate,
  monthlyCostIdr: amount,
  notes: optionalText(300),
});

export const capacitySchema = z.object({
  userId: z.string().uuid("Choose a person"),
  effectiveFrom: isoDate,
  weeklyHours: z.number({ error: "Enter hours" }).finite().min(0, "0 or more").max(168, "168 at most"),
});

export const capacityOverrideSchema = z
  .object({
    userId: z.string().uuid("Choose a person"),
    periodStart: isoDate,
    periodEnd: isoDate,
    availableHours: hours,
    reason: optionalText(200),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "Ends before it starts", path: ["periodEnd"] });

export const roleTargetsSchema = z.object({
  targets: z.array(z.object({ role: z.enum(["pm", "designer_dev", "sales", "finance", "hr"]), targetPercent: percent })).min(1).max(5),
});

export const personTargetSchema = z.object({ userId: uuid, targetPercent: percent.nullable() });

export const revenueTargetsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  yearly: amount.nullable(),
  months: z.array(amount.nullable()).length(12),
});

export const fxRateSchema = z.object({
  currency: z.enum(CURRENCIES).refine((c) => c !== "IDR", "Pick a foreign currency"),
  rateToIdr: z.number({ error: "Enter the rate" }).finite().gt(0, "More than zero").max(10_000_000),
  effectiveFrom: isoDate,
});

const ruleSchema = z.object({ enabled: z.boolean(), value: z.number().finite().min(0).max(10_000) });
export const dashboardRulesSchema = z.object({
  rules: z.object({ budgetPct: ruleSchema, overdueTasks: ruleSchema, lateInvoiceDays: ruleSchema, marginPct: ruleSchema }),
  thresholds: z
    .object({ good: z.number().min(1).max(1000), watch: z.number().min(0).max(1000), concentration: percent, utilizationBand: percent })
    .refine((t) => t.watch < t.good, { message: "Watch must be below Good", path: ["watch"] }),
});
