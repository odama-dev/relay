import { z } from "zod";
import { ACCESS_LEVELS, APP_MODULES, DIVISIONS, EMPLOYMENT_TYPES, USER_ROLES } from "@/lib/roles";
import { isIsoDate } from "@/lib/time/pure";
import { LEAD_SOURCES, LEAD_TYPES } from "@/lib/sales/pure";

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
  // Phase 2 — People module: job role, division, level, title, manager.
  jobRoleId: z.string().optional().transform((v) => (v ? v : null)).pipe(z.string().uuid().nullable()),
  division: z.enum(DIVISIONS).nullable(),
  level: z.number().int().min(1).max(5).nullable(),
  jobTitle: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  managerId: z.string().optional().transform((v) => (v ? v : null)).pipe(z.string().uuid().nullable()),
  // Admin only — access and modules.
  accessLevel: z.enum(ACCESS_LEVELS),
  modules: z.array(z.enum(APP_MODULES)).max(APP_MODULES.length),
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
  sales_stale_days: z.number({ error: "Enter days" }).int("Whole days").min(1, "1–365 days").max(365, "1–365 days"),
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

/** PRD Phase 2: at least one hour — smaller work goes in a checklist. */
const taskEstimate = z.number({ error: "Enter hours" }).finite().min(1, "At least 1 hour — fold smaller work into a checklist").max(1000);

export const taskSchema = z.object({
  title: text(240).min(1, "Enter a title"),
  sectionId: uuid,
  ownerId: optionalUuid,
  collaboratorIds: z.array(z.string().uuid()).max(30).default([]),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(TASK_STATUSES).default("todo"),
  dueDate: optionalIsoDate,
  estimateHours: taskEstimate.nullable().optional().transform((v) => (v == null ? null : v)),
  typeId: optionalUuid,
  reviewerId: optionalUuid,
  deliverableUrl: optionalUrl,
});
export type TaskInput = z.input<typeof taskSchema>;

/** A task you add for yourself to any open project (My Tasks); you own it. */
export const ownTaskSchema = z.object({
  projectId: uuid,
  title: text(240).min(1, "Enter a title"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  dueDate: optionalIsoDate,
});
export type OwnTaskInput = z.input<typeof ownTaskSchema>;

export const taskPatchSchema = z
  .object({
    title: text(240).min(1, "Enter a title"),
    sectionId: uuid,
    ownerId: z.string().uuid().nullable(),
    collaboratorIds: z.array(z.string().uuid()).max(30),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    dueDate: isoDate.nullable(),
    estimateHours: taskEstimate.nullable(),
    typeId: uuid,
    reviewerId: z.string().uuid().nullable(),
    deliverableUrl: z.string().trim().url("Enter a valid URL").nullable(),
    /** Required when a due date that's already set moves (PRD Phase 2). */
    dueReason: text(500),
  })
  .partial();
export type TaskPatch = z.input<typeof taskPatchSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approve", "changes"]),
  note: optionalText(2000),
});

export const dueChangeDecisionSchema = z.object({ approve: z.boolean(), note: optionalText(500) });

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

export const PAYMENT_PLATFORMS = ["xendit", "bank_transfer", "wise", "paypal", "other"] as const;
export const INVOICE_KINDS = ["dp", "term", "final"] as const;

export const invoiceSchema = z.object({
  projectId: uuid,
  issueDate: isoDate,
  /** Filled from the project and its client; editable on a draft. */
  currency: z.enum(CURRENCIES),
  billToName: text(200).min(1, "Who is the invoice for?"),
  billToAddress: optionalText(1000),
  billToEmail: optionalEmail,
  notes: optionalText(2000),
  /** Phase 2 · M9 — DP / term / final, and how the client pays. */
  kind: z.enum(INVOICE_KINDS).nullable().optional().transform((v) => v ?? null),
  platform: z.enum(PAYMENT_PLATFORMS).default("xendit"),
  items: z.array(invoiceItemSchema).min(1, "Add at least one item").max(100),
  requests: z.array(paymentRequestSchema).min(1, "Add at least one payment request").max(12),
});
export type InvoiceInput = z.input<typeof invoiceSchema>;

/** What Sales / Finance may set by hand on an issued invoice; null = automatic. */
export const MANUAL_INVOICE_STATUSES = ["sent", "partially_paid", "payment_submitted", "paid", "overdue"] as const;
export const manualInvoiceStatus = z.enum(MANUAL_INVOICE_STATUSES).nullable();

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

// ---------------------------------------------------------------------------
// HR — calendar and leave
// ---------------------------------------------------------------------------

export const HR_EVENT_COLORS = ["gray", "blue", "green", "amber", "red", "purple", "teal"] as const;
export const HR_EVENT_RECURRENCES = ["none", "weekly", "monthly"] as const;
export const LEAVE_KINDS = ["annual_leave", "permit", "sick", "other"] as const;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 09:30");

/** One event's details — shared by "add", "edit the series" and "edit only this one". */
export const hrEventFieldsSchema = z
  .object({
    title: text(200).min(1, "Give the event a title"),
    notes: optionalText(2000),
    color: z.enum(HR_EVENT_COLORS).default("blue"),
    startDate: isoDate,
    endDate: isoDate,
    allDay: z.boolean().default(true),
    startTime: clock.optional(),
    endTime: clock.optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "Ends before it starts", path: ["endDate"] })
  .refine((v) => v.allDay || (v.startTime && v.endTime), { message: "Set a start and end time", path: ["startTime"] })
  .refine((v) => v.allDay || v.endDate > v.startDate || (v.endTime ?? "") > (v.startTime ?? ""), { message: "Ends before it starts", path: ["endTime"] });

export const hrEventSchema = hrEventFieldsSchema.and(
  z
    .object({ recurrence: z.enum(HR_EVENT_RECURRENCES).default("none"), repeatUntil: optionalIsoDate })
    .transform((v) => (v.recurrence === "none" ? { ...v, repeatUntil: undefined } : v)),
);
export type HrEventInput = z.input<typeof hrEventSchema>;

/** Edit or delete: the whole series, or just the occurrence that starts on `occurrenceDate`. */
export const hrEventScopeSchema = z.object({ id: uuid, scope: z.enum(["series", "occurrence"]), occurrenceDate: isoDate });

export const leaveRequestSchema = z
  .object({
    kind: z.enum(LEAVE_KINDS),
    startDate: isoDate,
    endDate: isoDate,
    halfDay: z.boolean().default(false),
    reason: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "Ends before it starts", path: ["endDate"] })
  .refine((v) => !v.halfDay || v.endDate === v.startDate, { message: "A half day covers one day", path: ["halfDay"] });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

export const leaveDecisionSchema = z.object({ id: uuid, decision: z.enum(["approved", "rejected"]), note: optionalText(500) });

// ---------------------------------------------------------------------------
// Phase 2 · M6 — job roles, task types, holidays, attendance
// ---------------------------------------------------------------------------

export const jobRoleSchema = z.object({
  name: text(120).min(1, "Enter a name"),
  division: z.enum(DIVISIONS),
  level: z.number().int().min(1).max(5),
  defaultAccess: z.enum(ACCESS_LEVELS),
  defaultModules: z.array(z.enum(APP_MODULES)).max(APP_MODULES.length),
  hasOkr: z.boolean(),
});
export type JobRoleInput = z.input<typeof jobRoleSchema>;

export const taskTypeSchema = z.object({ name: text(60).min(1, "Enter a name") });

export const holidaySchema = z.object({ date: isoDate, name: text(120).min(1, "Enter a name") });
export type HolidayInput = z.input<typeof holidaySchema>;

export const ATTENDANCE_STATUSES = ["present", "remote", "off"] as const;
export const attendanceSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES), note: optionalText(500) });

// ---------------------------------------------------------------------------
// Phase 2 · M7 — KPI & OKR
// ---------------------------------------------------------------------------

export const objectionSchema = z.object({ metricKey: optionalText(80), reason: text(2000).min(10, "Explain what's wrong (at least a sentence)") });
export const objectionDecisionSchema = z.object({ upheld: z.boolean(), note: text(2000).min(1, "Add a note for the person") });

const optionalNumber = z.number().finite().min(0).max(1_000_000).nullable().optional().transform((v) => (v == null ? null : v));

export const WORK_LOG_KIND_VALUES = ["shot", "content", "idea", "support_request", "qc_record", "error", "release", "testimony", "challenge"] as const;
export const workLogSchema = z.object({
  kind: z.enum(WORK_LOG_KIND_VALUES),
  userId: optionalUuid,
  projectId: optionalUuid,
  taskId: optionalUuid,
  occurredOn: isoDate,
  title: text(200).min(1, "Give it a title"),
  description: optionalText(4000),
  tag: optionalText(40),
  link: optionalUrl,
  value: optionalNumber,
  total: optionalNumber,
});
export type WorkLogInput = z.input<typeof workLogSchema>;

export const workLogReviewSchema = z.object({ approve: z.boolean(), note: optionalText(1000), value: optionalNumber });

export const ratingSubmitSchema = z.object({
  formId: uuid,
  subjectId: uuid,
  periodStart: isoDate,
  scores: z.record(z.string().uuid(), z.number().int().min(1, "Score 1–5").max(5, "Score 1–5")),
  comment: optionalText(2000),
});

export const objectiveSchema = z.object({
  cycleId: uuid,
  title: text(200).min(1, "Give the objective a title"),
  description: optionalText(2000),
  isStudio: z.boolean().default(false),
  parentId: optionalUuid,
  ownerIds: z.array(z.string().uuid()).min(1, "Pick at least one owner").max(10),
});
export type ObjectiveInput = z.input<typeof objectiveSchema>;

export const KEY_RESULT_KINDS = ["milestone", "count", "percent", "lower_better", "kpi_linked"] as const;
export const KEY_RESULT_SOURCES = ["metric", "tasks", "manual"] as const;
export const keyResultSchema = z
  .object({
    title: text(200).min(1, "Give the key result a title"),
    kind: z.enum(KEY_RESULT_KINDS),
    source: z.enum(KEY_RESULT_SOURCES),
    metricId: optionalUuid,
    startValue: optionalNumber,
    targetValue: optionalNumber,
    unit: text(30).default(""),
    doneDefinition: optionalText(1000),
    approverId: optionalUuid,
    taskIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .superRefine((k, ctx) => {
    if ((k.source === "metric" || k.kind === "kpi_linked") && !k.metricId) ctx.addIssue({ code: "custom", message: "Pick the metric", path: ["metricId"] });
    if (k.kind !== "milestone" && k.targetValue === null) ctx.addIssue({ code: "custom", message: "Set a target", path: ["targetValue"] });
    if (k.kind === "milestone" && !k.approverId) ctx.addIssue({ code: "custom", message: "A milestone needs an approver (the direct manager)", path: ["approverId"] });
  });
export type KeyResultInput = z.input<typeof keyResultSchema>;

export const krCheckinSchema = z.object({ month: isoDate, value: optionalNumber, note: optionalText(1000), evidenceUrl: optionalUrl });
export const okrCycleSchema = z.object({ name: text(60).min(1, "Name the cycle"), startDate: isoDate, endDate: isoDate, status: z.enum(["draft", "active", "closed"]) });

export const metricSaveSchema = z.object({
  name: text(80).min(1, "Name the metric"),
  description: optionalText(2000),
  unit: text(30).default(""),
  direction: z.enum(["higher", "lower", "record"]),
  manual: z.boolean().default(false),
  definition: z.unknown(),
});
export type MetricSaveInput = z.input<typeof metricSaveSchema>;

export const templateMetaSchema = z.object({ name: text(80).min(1, "Name the template"), kind: z.enum(["core", "addon"]), description: optionalText(2000) });
export type TemplateMetaInput = z.input<typeof templateMetaSchema>;

export const templateItemsSchema = z
  .array(
    z.object({
      metricId: uuid,
      target: z.number().finite().min(0).max(1_000_000).nullable(),
      targetPer: z.enum(["week", "month", "semester"]),
      scorePeriod: z.enum(["monthly", "semester"]),
      weight: z.number().finite().min(0).max(100),
      recordOnly: z.boolean(),
      tag: z.string().trim().max(40).nullable().optional().transform((v) => (v ? v : null)),
    }),
  )
  .max(30);
export type TemplateItemsInput = z.input<typeof templateItemsSchema>;

export const roleTemplatesSchema = z.object({ core: z.array(z.string().uuid()).max(5), addons: z.array(z.string().uuid()).max(10) });
export const personAssignmentSchema = z.object({ userId: uuid, lineageId: uuid, kind: z.enum(["core", "addon"]) });

export const ratingFormSchema = z.object({
  metricId: uuid,
  name: text(80).min(1, "Name the form"),
  frequency: z.enum(["weekly", "monthly"]),
  raterKind: z.enum(["manager", "self", "project_peer", "job_role", "assigned"]),
  raterJobRoleId: optionalUuid,
  needsApproval: z.boolean(),
  criteria: z
    .array(z.object({ title: text(120).min(1, "Name each criterion"), scale: z.array(text(300).min(1, "Describe every score")).length(5) }))
    .min(1, "Add at least one criterion")
    .max(10),
});
export type RatingFormInput = z.input<typeof ratingFormSchema>;
export const formRatersSchema = z.object({ subjectId: uuid, raterIds: z.array(z.string().uuid()).max(20) });

// ---------------------------------------------------------------------------
// Phase 2 · M9 — Sales
// ---------------------------------------------------------------------------

export const STAGE_CATEGORIES = ["open", "won", "lost"] as const;
const probability = z.number({ error: "Enter a probability" }).int("Whole percent").min(0, "0 or more").max(100, "100 at most");

export const stageSchema = z.object({
  name: text(60).min(1, "Name the stage"),
  category: z.enum(STAGE_CATEGORIES),
  probability,
});
export type StageInput = z.input<typeof stageSchema>;

export const dealSchema = z.object({
  title: text(160).min(1, "Name the lead"),
  personId: optionalUuid,
  companyId: optionalUuid,
  leadDate: isoDate,
  lastContactOn: optionalIsoDate,
  value: amount,
  currency: z.enum(CURRENCIES),
  ownerId: optionalUuid,
  leadSource: z.enum(LEAD_SOURCES).nullable().optional().transform((v) => v ?? null),
  leadType: z.enum(LEAD_TYPES).nullable().optional().transform((v) => v ?? null),
  stageId: uuid,
  /** Only read when the deal is won or lost; an open deal's last stage is its stage. */
  lastStageId: optionalUuid,
  lostReason: optionalText(500),
});
export type DealInput = z.input<typeof dealSchema>;

export const dealMoveSchema = z.object({ stageId: uuid, lostReason: optionalText(500) });

const fxRate = z.number({ error: "Enter the rate" }).finite().positive("More than zero").max(1_000_000_000).nullable().optional().transform((v) => v ?? null);

export const paymentProofSchema = z.object({
  paymentRequestId: optionalUuid,
  amount: amount.refine((v) => v > 0, "More than zero"),
  paidOn: isoDate,
  platform: z.enum(PAYMENT_PLATFORMS),
  note: optionalText(1000),
  fxRateToIdr: fxRate,
});
export type PaymentProofInput = z.input<typeof paymentProofSchema>;

export const proofDecisionSchema = z
  .object({ verify: z.boolean(), note: optionalText(1000), fxRateToIdr: fxRate })
  .refine((v) => v.verify || v.note, { message: "Say why the proof is rejected", path: ["note"] });

// ---------------------------------------------------------------------------
// Phase 2 · M10 — Finance obligations
// ---------------------------------------------------------------------------

export const OBLIGATION_KINDS = ["payroll", "bpjs", "tax", "other"] as const;
export const OBLIGATION_RECURRENCES = ["monthly", "yearly", "once"] as const;

export const obligationSchema = z
  .object({
    title: text(120).min(1, "Name it"),
    kind: z.enum(OBLIGATION_KINDS),
    recurrence: z.enum(OBLIGATION_RECURRENCES),
    dayOfMonth: z.number({ error: "Enter a day" }).int().min(1, "1–31").max(31, "1–31"),
    month: z.number().int().min(1).max(12).nullable().optional().transform((v) => v ?? null),
    onDate: optionalIsoDate,
    amountEstimate: amount.nullable().optional().transform((v) => v ?? null),
    currency: z.enum(CURRENCIES).default("IDR"),
    notes: optionalText(1000),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.recurrence !== "yearly" || v.month, { message: "Choose the month", path: ["month"] })
  .refine((v) => v.recurrence !== "once" || v.onDate, { message: "Choose the date", path: ["onDate"] });
export type ObligationInput = z.input<typeof obligationSchema>;

export const obligationDoneSchema = z.object({ obligationId: uuid, dueDate: isoDate, done: z.boolean() });

// ---------------------------------------------------------------------------
// Sales CRM — Companies and People with custom columns
// ---------------------------------------------------------------------------

export const CRM_OBJECTS = ["company", "person"] as const;

export const crmColumnSchema = z.object({
  object: z.enum(CRM_OBJECTS),
  name: text(60).min(1, "Name the column"),
  type: z.enum(["text", "number", "currency", "date", "checkbox", "select", "multi_select", "url", "email", "phone"]),
  options: z.array(z.object({ id: z.string().min(1).max(40), label: text(60).min(1, "Name the option"), color: z.string().max(20) })).max(50).default([]),
});
export type CrmColumnInput = z.input<typeof crmColumnSchema>;

export const crmColumnEditSchema = crmColumnSchema.pick({ name: true, options: true });

export const crmCompanySchema = z.object({ name: text(160).min(1, "Name the company"), domain: optionalText(200) });
export const crmPersonSchema = z.object({ name: text(160).min(1, "Enter a name"), email: optionalEmail, companyId: optionalUuid });

/** A note on a client, company, person or deal (at least one). */
export const crmNoteSchema = z
  .object({
    body: text(5000).min(1, "Write the note"),
    clientId: optionalUuid,
    companyId: optionalUuid,
    personId: optionalUuid,
    dealId: optionalUuid,
  })
  .refine((v) => v.clientId || v.companyId || v.personId || v.dealId, { message: "Choose what the note is about", path: ["body"] });
export const crmNoteEditSchema = z.object({ body: text(5000).min(1, "Write the note") });

/** One cell: a built-in field by name, or a custom column by id. */
export const crmFieldSchema = z.object({ object: z.enum(CRM_OBJECTS), id: uuid, key: z.string().min(1).max(60), value: z.unknown() });

// ---------------------------------------------------------------------------
// Mail — connected mailboxes (IMAP + SMTP) and sending from them
// ---------------------------------------------------------------------------

const host = text(200)
  .min(1, "Enter the server")
  .regex(/^[a-z0-9.-]+$/i, "A host name like imap.yourdomain.com");
const port = z.number({ error: "Enter the port" }).int().min(1).max(65535);

export const mailAccountSchema = z.object({
  email,
  displayName: optionalText(120),
  imapHost: host,
  imapPort: port,
  imapSecure: z.boolean(),
  smtpHost: host,
  smtpPort: port,
  smtpSecure: z.boolean(),
  username: text(200).min(1, "Enter the username (often the full address)"),
  password: z.string().min(1, "Enter the password or app password").max(500),
  shared: z.boolean(),
});
export type MailAccountInput = z.input<typeof mailAccountSchema>;

export const mailAccountEditSchema = z.object({
  displayName: optionalText(120),
  shared: z.boolean(),
  isActive: z.boolean(),
  /** Only when it changed; the connection is tested again. */
  password: z.string().max(500).optional().transform((v) => v || undefined),
});

export const composeMailSchema = z.object({
  accountId: uuid,
  to: z.array(email).min(1, "Add a recipient").max(20),
  cc: z.array(email).max(20).default([]),
  subject: text(300).min(1, "Enter a subject"),
  text: z.string().trim().min(1, "Write the message").max(50_000),
  inReplyTo: optionalText(500),
});
export type ComposeMailInput = z.input<typeof composeMailSchema>;
