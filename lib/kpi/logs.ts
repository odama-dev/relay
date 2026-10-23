import type { WorkLogKind } from "@prisma/client";

/**
 * Work log kinds (PRD Phase 2 "Output", the KPI Master "Log di OS" sources):
 * what each records, its tags and which number fields it carries.
 */
export const WORK_LOG_KINDS: WorkLogKind[] = ["shot", "content", "idea", "support_request", "qc_record", "error", "release", "testimony", "challenge"];

export type LogKindConfig = {
  label: string;
  hint: string;
  /** Tag choices (one picked); metrics filter on them. */
  tags?: { value: string; label: string }[];
  /** Number fields: value (and total, for a ratio). */
  value?: string;
  total?: string;
  linkLabel?: string;
  linkRequired?: boolean;
  /** Recorded about someone else (errors, QC) rather than by the person. */
  aboutOthers?: boolean;
};

export const LOG_KINDS: Record<WorkLogKind, LogKindConfig> = {
  shot: { label: "Shot", hint: "Counted once delivered with its Figma link and approved by the AD/CD.", value: "Revisions asked by the AD/CD", linkLabel: "Figma link", linkRequired: true },
  content: { label: "Content", hint: "A finished piece of content, approved.", linkLabel: "Link" },
  idea: {
    label: "Idea",
    hint: "Problem, proposal and impact. The AD/CD answers within 3 working days — after that it counts anyway.",
    tags: [
      { value: "skill_contribution", label: "Skill contribution" },
      { value: "creative_leadership", label: "Creative leadership" },
      { value: "development", label: "Development" },
    ],
  },
  support_request: {
    label: "Support request",
    hint: "A request you resolved. Mark it escalated when you had to hand it on.",
    tags: [
      { value: "self_resolved", label: "Resolved myself" },
      { value: "escalated", label: "Escalated" },
    ],
  },
  qc_record: {
    label: "QC record",
    hint: "A product QC'd ready for handover, or an internal revision caught before the client saw it.",
    tags: [
      { value: "product", label: "Product QC'd" },
      { value: "internal_revision", label: "Internal revision" },
    ],
    aboutOthers: true,
  },
  error: { label: "Error", hint: "A mistake that reached the client or the public and had to be fixed. Evidence required.", linkLabel: "Evidence link", aboutOthers: true },
  release: { label: "Release", hint: "A product deployed to production and approved by the PM or client.", value: "Bugs found after release", total: "Tasks in the release", linkLabel: "Release link" },
  testimony: { label: "Testimony", hint: "A testimony form, or a screenshot / link of the client's appreciation. One per project counts.", linkLabel: "Evidence link" },
  challenge: { label: "Challenge", hint: "A self-improvement challenge with its result, validated by the Lead PM.", linkLabel: "Result link" },
};
