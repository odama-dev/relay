import { describe, expect, it } from "vitest";
import { findMentions } from "./mentions";

const people = [
  { id: "1", name: "Ana" },
  { id: "2", name: "Ana Putri" },
  { id: "3", name: "Budi Santoso" },
];

describe("findMentions", () => {
  it("prefers the longest matching name", () => {
    expect(findMentions("@Ana Putri can you check?", people)).toEqual(["2"]);
    expect(findMentions("thanks @Ana!", people)).toEqual(["1"]);
  });

  it("finds several, ignores emails and unknown names", () => {
    expect(findMentions("@budi santoso and (@Ana) — ana@odama.io @Nobody", people)).toEqual(["3", "1"]);
  });

  it("handles no members", () => {
    expect(findMentions("@Ana", [])).toEqual([]);
  });
});
