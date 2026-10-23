import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdminConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Private file storage (PRD: Supabase Storage for task images and invoice
 * PDFs). Buckets are private with no storage policies, so files are only
 * reachable through the app, which checks access under RLS first and then
 * redirects to a short-lived signed URL.
 *
 * Without Supabase (local DEV_AUTH_BYPASS) files go to ./.data/storage.
 */
export type Bucket = "task-images" | "invoices" | "receipts" | "evidence" | "payment-proofs";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");
const SIGNED_URL_TTL = 60; // seconds

function localPath(bucket: Bucket, key: string): string {
  const full = path.resolve(LOCAL_ROOT, bucket, key);
  if (!full.startsWith(path.resolve(LOCAL_ROOT, bucket) + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function putFile(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void> {
  if (supabaseAdminConfigured) {
    const { error } = await createAdminClient().storage.from(bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return;
  }
  const file = localPath(bucket, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

export async function getFile(bucket: Bucket, key: string): Promise<Buffer | null> {
  if (supabaseAdminConfigured) {
    const { data, error } = await createAdminClient().storage.from(bucket).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  try {
    return await readFile(localPath(bucket, key));
  } catch {
    return null;
  }
}

/** Best effort: a file left behind is harmless (the bucket is private). */
export async function removeFile(bucket: Bucket, key: string): Promise<void> {
  try {
    if (supabaseAdminConfigured) await createAdminClient().storage.from(bucket).remove([key]);
    else await rm(localPath(bucket, key), { force: true });
  } catch (err) {
    console.error("[storage] failed to remove", bucket, key, err);
  }
}

/** A signed URL to redirect to, or null when files are served by the app itself (local). */
export async function signedUrl(bucket: Bucket, key: string): Promise<string | null> {
  if (!supabaseAdminConfigured) return null;
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUrl(key, SIGNED_URL_TTL);
  if (error || !data) return null;
  return data.signedUrl;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** M2.5 — 10 MB per image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Expense receipts: a PDF or a photo of the bill, up to 10 MB. */
export const RECEIPT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  ...IMAGE_TYPES,
};
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
