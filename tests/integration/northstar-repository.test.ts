import { describe, expect, it } from "vitest";

import { northstarRepository, northstarSql } from "@/lib/northstar";

describe("Northstar repository SQLite fallback", () => {
  it("serves typed record queries and live health data", async () => {
    expect(northstarRepository.provider).toBe("sqlite");
    await expect(northstarRepository.healthCheck()).resolves.toEqual({
      provider: "sqlite",
      records: 2090,
    });

    const matches = await northstarRepository.listRecords({
      type: "PURCHASE_ORDER",
      confirmation: "AWAITING_RESPONSE",
    });
    expect(matches).toHaveLength(23);
    expect(matches.some((record) => record.number === "PO-10482")).toBe(true);
  });

  it("rolls back an unsuccessful transaction", async () => {
    const before = await northstarRepository.findRecord("PO-10482");
    await expect(
      northstarRepository.transaction(async (transaction) => {
        await transaction.run(
          northstarSql({
            postgres: "UPDATE records SET status = $1 WHERE number = $2",
            sqlite: "UPDATE records SET status = ? WHERE number = ?",
          }),
          ["CORRUPTED", "PO-10482"],
        );
        throw new Error("rollback test");
      }),
    ).rejects.toThrow("rollback test");

    const after = await northstarRepository.findRecord("PO-10482");
    expect(after?.status).toBe(before?.status);
  });
});
