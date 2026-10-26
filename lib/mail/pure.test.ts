import { describe, expect, it } from "vitest";
import { cleanDomain, domainOf, linkToCrm, nextWindow, snippetOf, suggestServers } from "./pure";

describe("mail addresses", () => {
  it("reads the domain of an address", () => {
    expect(domainOf("rina@Acme.co")).toBe("acme.co");
    expect(domainOf("no-at-sign")).toBeNull();
    expect(cleanDomain("https://www.acme.co/about")).toBe("acme.co");
    expect(cleanDomain("")).toBeNull();
  });
  it("suggests imap. and smtp. hosts", () => {
    expect(suggestServers("me@odama.io")).toEqual({
      imapHost: "imap.odama.io",
      smtpHost: "smtp.odama.io",
    });
  });
});

describe("snippetOf", () => {
  it("flattens the body and drops quoted replies", () => {
    expect(snippetOf("Hi Rafi,\n\nThe brief is attached.\n\nOn Mon, 3 Oct 2026, Sari wrote:\n> old text")).toBe("Hi Rafi, The brief is attached.");
    expect(snippetOf("a".repeat(300), 10)).toBe("aaaaaaaaa…");
    expect(snippetOf(null)).toBe("");
  });
});

describe("linkToCrm", () => {
  const people = [{ id: "p1", email: "Rina@acme.co", companyId: "c1" }];
  const companies = [
    { id: "c1", domain: "acme.co" },
    { id: "c2", domain: "https://beta.io" },
  ];
  it("prefers a person with that address, bringing their company", () => {
    expect(linkToCrm(["rina@acme.co"], "odama.io", people, companies)).toEqual({
      personId: "p1",
      companyId: "c1",
    });
  });
  it("falls back to a company by domain", () => {
    expect(linkToCrm(["ceo@beta.io"], "odama.io", people, companies)).toEqual({
      personId: null,
      companyId: "c2",
    });
  });
  it("never links by webmail or your own domain", () => {
    expect(linkToCrm(["someone@gmail.com"], "odama.io", people, [{ id: "g", domain: "gmail.com" }])).toEqual({ personId: null, companyId: null });
    expect(linkToCrm(["colleague@odama.io"], "odama.io", people, [{ id: "o", domain: "odama.io" }])).toEqual({ personId: null, companyId: null });
  });
});

describe("nextWindow", () => {
  it("continues after the last UID while UIDVALIDITY holds", () => {
    expect(nextWindow({ uid: 41, validity: "7" }, "7")).toEqual({ from: 42 });
  });
  it("starts over on the first sync or a reset folder", () => {
    expect(nextWindow(undefined, "7")).toEqual({ since: true });
    expect(nextWindow({ uid: 41, validity: "7" }, "8")).toEqual({
      since: true,
    });
  });
});
