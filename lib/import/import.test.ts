import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, toRecords } from "./csv";
import { IMPORT_COLUMNS, IMPORT_EXAMPLES } from "./templates";
import { validateClients, validateProjects, validateUsers } from "./validate";

const csv = (header: readonly string[], ...rows: string[][]) => toCsv([[...header], ...rows]);
const records = (kind: keyof typeof IMPORT_COLUMNS, ...rows: string[][]) => {
  const res = toRecords(parseCsv(csv(IMPORT_COLUMNS[kind], ...rows)), IMPORT_COLUMNS[kind]);
  if (!res.ok) throw new Error(res.error);
  return res.records;
};

describe("parseCsv", () => {
  it("handles quotes, embedded commas, newlines and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [["a", "b,c"], ['q"uote', "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("ignores a BOM and checks the header", () => {
    expect(toRecords(parseCsv("﻿email\nx"), ["email", "role"])).toEqual({ ok: false, error: "Missing columns: role. Use the template header." });
    expect(toRecords(parseCsv("email,nope\n"), ["email"])).toMatchObject({ ok: false });
    // Template headers may carry the "*" required marker.
    expect(toRecords(parseCsv("email*\nx"), ["email"])).toMatchObject({ ok: true, records: [{ line: 2, values: { email: "x" } }] });
  });
});

describe("users.csv", () => {
  it("validates and decides create / skip / update", () => {
    const rows = records(
      "users",
      IMPORT_EXAMPLES.users,
      ["Budi", "BUDI@odama.io", "pm", "contract", ""],
      ["Bad", "nope", "ceo", "x", "maybe"],
      ["Dup", "ana@odama.io", "pm", "full_time", "false"],
    );
    const ctx = { existingEmails: new Set(["budi@odama.io"]) };
    const skip = validateUsers(rows, ctx, "skip");
    expect(skip.map((r) => r.action)).toEqual(["create", "skip", "error", "error"]);
    expect(skip[1]!.data).toMatchObject({ email: "budi@odama.io", isAdmin: false });
    expect(skip[2]!.errors).toHaveLength(4);
    expect(skip[3]!.errors).toEqual(["email appears twice in the file"]);
    expect(validateUsers(rows, ctx, "update")[1]!.action).toBe("update");
  });
});

describe("clients.csv", () => {
  it("checks code format, ownership and lock", () => {
    const rows = records(
      "clients",
      IMPORT_EXAMPLES.clients,
      ["BETA", "Beta", "", "Mars/Olympus", "XYZ", "bad", "", "", "", "x@y.z", ""],
      ["acme", "Other", "", "", "IDR", "", "", "", "", "", ""],
    );
    const ctx = { byName: new Map(), codes: new Map([["ACME", "Acme Corp"]]) };
    const res = validateClients(rows, ctx, "skip");
    expect(res[0]!.action).toBe("create");
    expect(res[0]!.data?.contact).toEqual({ name: "Jane Doe", email: "jane@acme.com", title: "Head of Marketing" });
    expect(res[1]!.errors).toEqual([
      "default_currency must be one of IDR, USD, EUR, SGD, AUD",
      "timezone is not a valid IANA zone",
      "billing_email is not valid",
      "contact_name is required with contact details",
    ]);
    expect(res[2]!.errors).toContain("code appears twice in the file");
  });

  it("won't change the code of a client with projects", () => {
    const rows = records("clients", ["ACMX", "Acme Corp", "", "", "USD", "", "", "", "", "", ""]);
    const ctx = { byName: new Map([["Acme Corp", { code: "ACME", hasProjects: true }]]), codes: new Map([["ACME", "Acme Corp"]]) };
    expect(validateClients(rows, ctx, "skip")[0]!.action).toBe("skip");
    expect(validateClients(rows, ctx, "update")[0]!.errors).toEqual(["the code can't change: the client already has projects"]);
  });
});

describe("projects.csv", () => {
  const people = new Map([
    ["pm@odama.io", { id: "pm-1", role: "pm" as const, deactivated: false }],
    ["ana@odama.io", { id: "u-ana", role: "designer_dev" as const, deactivated: false }],
    ["budi@odama.io", { id: "u-budi", role: "designer_dev" as const, deactivated: true }],
  ]);
  const clients = new Map([["Acme Corp", { id: "c-acme", defaultCurrency: "USD" }]]);

  it("resolves client, PM and members", () => {
    const row = [...IMPORT_EXAMPLES.projects];
    row[14] = "ana@odama.io";
    const [res] = validateProjects(records("projects", row), { clients, people, existing: new Set() }, "skip");
    expect(res).toMatchObject({
      action: "create",
      data: { clientId: "c-acme", pmId: "pm-1", contractValue: 15000.5, budgetHours: 320, memberIds: ["u-ana"], status: "active" },
    });
  });

  it("requires retainer hours, a cap for capped rollover, and known people", () => {
    const row = ["Care", "client", "Acme Corp", "retainer", "", "15,000", "ana@odama.io", "", "2026-13-01", "", "", "", "capped", "", "budi@odama.io;nobody@x.io", "ftp://x", "", "", ""];
    const [res] = validateProjects(records("projects", row), { clients, people, existing: new Set() }, "skip");
    expect(res!.errors).toEqual([
      "contract_value must be a number like 15000.50",
      "ana@odama.io isn't a PM or C-Level",
      "start_date must be YYYY-MM-DD",
      "retainer_hours_per_month is required for retainers",
      "rollover_cap_hours is required when rollover_mode is capped",
      "member budi@odama.io is deactivated",
      "member nobody@x.io not found",
      "notion_url must start with http(s)://",
    ]);
  });

  it("takes the client's currency by default and matches existing by name + client", () => {
    const row = ["Website Redesign", "client", "Acme Corp", "fixed", "", "", "pm@odama.io", "", "2026-10-01", "", "", "", "", "", "", "", "", "", ""];
    const [res] = validateProjects(records("projects", row), { clients, people, existing: new Set(["c-acme:Website Redesign"]) }, "update");
    expect(res).toMatchObject({ action: "update", data: { currency: "USD" } });
  });

  it("imports internal projects without a client", () => {
    const row = ["R&D", "internal", "", "", "", "", "pm@odama.io", "", "2026-10-01", "", "", "", "", "", "", "", "", "", ""];
    const [res] = validateProjects(records("projects", row), { clients, people, existing: new Set() }, "skip");
    expect(res).toMatchObject({ action: "create", key: "internal:R&D", data: { clientId: null, contractType: null, currency: "IDR" } });
  });
});
