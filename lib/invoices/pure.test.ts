import { describe, expect, it } from "vitest";
import {
  deriveInvoiceStatus,
  formatInvoiceNumber,
  fxRateToIdr,
  invoiceTotal,
  normalizeToIdr,
  itemAmount,
  requestsMatchTotal,
  splitByPercent,
  requestPercent,
  type RequestState,
} from "./pure";

describe("invoice totals", () => {
  it("multiplies quantity by unit price without float drift", () => {
    expect(itemAmount({ quantity: 3, unitPrice: 0.1 }, "USD")).toBe(0.3);
    expect(invoiceTotal([{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], "USD")).toBe(0.5);
    expect(invoiceTotal([{ quantity: 2, unitPrice: 15_000_000 }], "IDR")).toBe(30_000_000);
  });

  it("rounds IDR to whole rupiah", () => {
    expect(itemAmount({ quantity: 1.5, unitPrice: 333 }, "IDR")).toBe(500);
  });
});

describe("payment requests", () => {
  it("splits by percent and settles rounding on the last part", () => {
    expect(splitByPercent(1000, [50, 50], "USD")).toEqual([500, 500]);
    expect(splitByPercent(100, [33.33, 33.33, 33.34], "USD")).toEqual([33.33, 33.33, 33.34]);
    expect(requestPercent(2550, 5100, "USD")).toBe(50);
    expect(requestPercent(33.33, 100, "USD")).toBe(33.3);
    expect(requestPercent(10, 0, "USD")).toBe(0);
    expect(splitByPercent(10_000_001, [50, 50], "IDR")).toEqual([5_000_001, 5_000_000]);
    const parts = splitByPercent(999.99, [30, 70], "USD");
    expect(requestsMatchTotal(999.99, parts, "USD")).toBe(true);
  });

  it("requires the requests to add up to the total", () => {
    expect(requestsMatchTotal(1000, [400, 600], "USD")).toBe(true);
    expect(requestsMatchTotal(1000, [400, 599.99], "USD")).toBe(false);
  });
});

describe("invoice numbers", () => {
  it("follows ODAMA/{YY}/{SEQ}", () => {
    expect(formatInvoiceNumber("ODAMA/{YY}/{SEQ}", 2026, 1)).toBe("ODAMA/26/0001");
    expect(formatInvoiceNumber("ODAMA/{YY}/{SEQ}", 2027, 42)).toBe("ODAMA/27/0042");
    expect(formatInvoiceNumber("INV-{YYYY}-{SEQ}", 2026, 7)).toBe("INV-2026-0007");
  });
});

describe("deriveInvoiceStatus", () => {
  const req = (amount: number, status: RequestState["status"], dueDate: string): RequestState => ({ amount, status, dueDate });
  const today = "2026-10-13";

  it("walks Sent → Partially paid → Paid", () => {
    const requests = [req(500, "pending", "2026-10-20"), req(500, "pending", "2026-11-20")];
    expect(deriveInvoiceStatus("sent", 1000, 0, requests, today, "USD")).toBe("sent");
    requests[0]!.status = "paid";
    expect(deriveInvoiceStatus("sent", 1000, 500, requests, today, "USD")).toBe("partially_paid");
    requests[1]!.status = "paid";
    expect(deriveInvoiceStatus("partially_paid", 1000, 1000, requests, today, "USD")).toBe("paid");
  });

  it("is overdue while an unpaid request is past due, and recovers once paid", () => {
    const requests = [req(500, "pending", "2026-10-01"), req(500, "pending", "2026-11-20")];
    expect(deriveInvoiceStatus("sent", 1000, 0, requests, today, "USD")).toBe("overdue");
    requests[0]!.status = "paid";
    expect(deriveInvoiceStatus("overdue", 1000, 500, requests, today, "USD")).toBe("partially_paid");
  });

  it("waits on Finance while a proof is pending, even when overdue — paid still wins", () => {
    const requests = [req(500, "pending", "2026-10-01"), req(500, "pending", "2026-11-20")];
    expect(deriveInvoiceStatus("overdue", 1000, 0, requests, today, "USD", true)).toBe("payment_submitted");
    expect(deriveInvoiceStatus("payment_submitted", 1000, 1000, requests, today, "USD", true)).toBe("paid");
    expect(deriveInvoiceStatus("payment_submitted", 1000, 0, requests, today, "USD", false)).toBe("overdue");
  });

  it("never touches drafts or void invoices", () => {
    expect(deriveInvoiceStatus("draft", 1000, 0, [], today, "USD")).toBe("draft");
    expect(deriveInvoiceStatus("void", 1000, 1000, [], today, "USD")).toBe("void");
  });
});

describe("fxRateToIdr", () => {
  it("is IDR received per unit paid", () => {
    expect(fxRateToIdr(16_250_000, 1000, "USD")).toBe(16_250);
    expect(fxRateToIdr(null, 1000, "USD")).toBeNull();
    expect(fxRateToIdr(5_000_000, 5_000_000, "IDR")).toBe(1);
  });
});

describe("normalizeToIdr", () => {
  it("sums currencies into whole rupiah", () => {
    expect(normalizeToIdr([{ currency: "IDR", amount: 1_000_000 }, { currency: "USD", amount: 10.5 }], { USD: 16_000.4 })).toBe(1_168_004);
  });
  it("refuses a partial total when a rate is missing", () => {
    expect(normalizeToIdr([{ currency: "USD", amount: 1 }, { currency: "SGD", amount: 1 }], { USD: 16_000 })).toBeNull();
  });
});
