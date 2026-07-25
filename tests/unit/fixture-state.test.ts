import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  STATE_VERSION,
  readFixtureState,
  validateFixtureState,
  writeFixtureStateAtomic,
  type FixtureState,
} from "../e2e/fixture-state";

const REF = "test-abcdef";
const NS = "pw-abcdef-1234";
const FREE_ID = "11111111-1111-4111-8111-111111111111";
const PAID_ID = "22222222-2222-4222-8222-222222222222";

function makeState(overrides: Partial<FixtureState> = {}): FixtureState {
  const now = new Date().toISOString();
  return {
    stateVersion: STATE_VERSION,
    status: "ready",
    testProjectRef: REF,
    namespace: NS,
    freeSlug: `${NS}-free`,
    paidSlug: `${NS}-paid`,
    freeCourseId: FREE_ID,
    paidCourseId: PAID_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function tmpPath(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fixstate-"));
  return path.join(dir, name);
}

describe("fixture-state", () => {
  describe("validateFixtureState", () => {
    it("accepts a well-formed state", () => {
      expect(() => validateFixtureState(makeState(), REF)).not.toThrow();
    });
    it("rejects project-ref mismatch", () => {
      expect(() => validateFixtureState(makeState(), "different-ref")).toThrow(/testProjectRef/);
    });
    it("rejects invalid UUID", () => {
      expect(() => validateFixtureState(makeState({ freeCourseId: "not-a-uuid" }), REF)).toThrow(
        /UUID/,
      );
    });
    it("rejects unsupported stateVersion", () => {
      expect(() =>
        validateFixtureState({ ...makeState(), stateVersion: 999 as unknown as 1 }, REF),
      ).toThrow(/stateVersion/);
    });
    it("rejects invalid namespace", () => {
      expect(() => validateFixtureState(makeState({ namespace: "%wildcard%" }), REF)).toThrow(
        /namespace/,
      );
    });
    it("rejects slug not starting with namespace", () => {
      expect(() => validateFixtureState(makeState({ freeSlug: "wrong-prefix-free" }), REF)).toThrow(
        /freeSlug/,
      );
    });
    it("rejects non-object input", () => {
      expect(() => validateFixtureState(null)).toThrow();
      expect(() => validateFixtureState("nope")).toThrow();
    });
  });

  describe("readFixtureState", () => {
    it("returns null for ENOENT only", async () => {
      const p = await tmpPath("missing.json");
      expect(await readFixtureState(p, REF)).toBeNull();
    });
    it("throws on invalid JSON", async () => {
      const p = await tmpPath("bad.json");
      await fs.writeFile(p, "{ not json");
      await expect(readFixtureState(p, REF)).rejects.toThrow(/valid JSON/);
    });
    it("throws on project-ref mismatch", async () => {
      const p = await tmpPath("mismatch.json");
      await fs.writeFile(p, JSON.stringify(makeState({ testProjectRef: "other-ref" })));
      await expect(readFixtureState(p, REF)).rejects.toThrow(/testProjectRef/);
    });
    it("throws on invalid UUID in state", async () => {
      const p = await tmpPath("baduuid.json");
      await fs.writeFile(p, JSON.stringify(makeState({ paidCourseId: "xxx" })));
      await expect(readFixtureState(p, REF)).rejects.toThrow(/UUID/);
    });
  });

  describe("writeFixtureStateAtomic", () => {
    it("writes when file does not exist", async () => {
      const p = await tmpPath("new.json");
      await writeFixtureStateAtomic(p, makeState(), { overwrite: false });
      const back = await readFixtureState(p, REF);
      expect(back?.status).toBe("ready");
    });
    it("refuses to overwrite existing file when overwrite=false", async () => {
      const p = await tmpPath("exists.json");
      await writeFixtureStateAtomic(p, makeState(), { overwrite: false });
      await expect(
        writeFixtureStateAtomic(p, makeState({ status: "creating" }), { overwrite: false }),
      ).rejects.toThrow(/refusing to overwrite/);
    });
    it("overwrites when overwrite=true (creating -> ready transition)", async () => {
      const p = await tmpPath("transition.json");
      await writeFixtureStateAtomic(p, makeState({ status: "creating" }), { overwrite: false });
      await writeFixtureStateAtomic(p, makeState({ status: "ready" }), { overwrite: true });
      const back = await readFixtureState(p, REF);
      expect(back?.status).toBe("ready");
    });
  });
});
