import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { gateSetDigest } from "../../scripts/verify-repository.ts";

describe("gate-set canonicalization", () => {
  it("sorts gates and object keys before hashing", () => {
    const expected = createHash("sha256")
      .update('[{"gateId":"a"},{"gateId":"b"}]')
      .digest("hex");
    expect(gateSetDigest([{ gateId: "b" }, { gateId: "a" }])).toBe(expected);
  });
});
