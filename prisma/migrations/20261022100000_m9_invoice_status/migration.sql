-- Phase 2 · M9: Sales uploaded a payment proof; Finance verifies it.
ALTER TYPE "invoice_status" ADD VALUE IF NOT EXISTS 'payment_submitted' AFTER 'partially_paid';
