"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { parseIsoDate } from "@/lib/time/pure";
import { ratingSubmitSchema, uuid } from "@/lib/validation";

/** Submit or update your rating (rating_responses_guard checks you may rate them and the comment rule). */
export async function submitRating(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(ratingSubmitSchema, raw);
    if (Object.values(d.scores).some((s) => s < 3) && !d.comment) fail("A comment is required for a score under 3.");
    const periodStart = parseIsoDate(d.periodStart);
    const row = await asUser(user, (tx) =>
      tx.ratingResponse.upsert({
        where: { formId_subjectId_raterId_periodStart: { formId: d.formId, subjectId: d.subjectId, raterId: user.id, periodStart } },
        // The guard derives the average from the scores.
        create: { formId: d.formId, subjectId: d.subjectId, raterId: user.id, periodStart, scores: d.scores, comment: d.comment ?? null, average: 0 },
        update: { scores: d.scores, comment: d.comment ?? null },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "rating_response", entityId: row.id, action: "submitted" });
    revalidatePath("/ratings");
  });
}

/** People approves a self-assessment (Lead PM, Creative Director, Art Director). */
export async function approveRating(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const responseId = parseOrFail(uuid, id);
    await asUser(user, (tx) => tx.ratingResponse.update({ where: { id: responseId }, data: { approvedBy: user.id } }));
    await logActivity({ actorId: user.id, entityType: "rating_response", entityId: responseId, action: "approved" });
    revalidatePath("/ratings");
  });
}
