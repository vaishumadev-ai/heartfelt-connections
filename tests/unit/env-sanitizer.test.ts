import { describe, expect, it } from "vitest";
import { sanitizeChildEnv } from "@/lib/testing/env-sanitizer";

const SERVICE = "sb_secret_ABCDEF_service_role_value";
const OTHER_SERVICE = "sb_secret_XYZ_another_service_role";

describe("env-sanitizer", () => {
  it("strips SUPABASE_SERVICE_ROLE_KEY and TEST_SUPABASE_SERVICE_ROLE_KEY from child env", () => {
    const r = sanitizeChildEnv({
      parentEnv: {
        SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        TEST_SUPABASE_SERVICE_ROLE_KEY: OTHER_SERVICE,
        OTHER: "keep",
      },
      overlay: {},
      serviceRoleValues: [SERVICE, OTHER_SERVICE],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      expect(r.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      expect(r.env.OTHER).toBe("keep");
    }
  });

  it("rejects a VITE_* variable whose name matches SERVICE_ROLE", () => {
    const r = sanitizeChildEnv({
      parentEnv: { VITE_SUPABASE_SERVICE_ROLE_KEY: "something" },
      overlay: {},
      serviceRoleValues: [SERVICE],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/service-role/i);
  });

  it("rejects a VITE_* variable whose name matches SERVICE_KEY", () => {
    const r = sanitizeChildEnv({
      parentEnv: { VITE_MY_SERVICE_KEY: "x" },
      overlay: {},
      serviceRoleValues: [SERVICE],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a VITE_* whose value equals a known service-role key", () => {
    const r = sanitizeChildEnv({
      parentEnv: { VITE_SUPABASE_PUBLISHABLE_KEY: SERVICE },
      overlay: {},
      serviceRoleValues: [SERVICE],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/SERVICE_ROLE/);
      expect(r.reason).not.toContain(SERVICE);
    }
  });

  it("rejects when overlay smuggles a service-role value into a VITE_ slot", () => {
    const r = sanitizeChildEnv({
      parentEnv: {},
      overlay: { VITE_SUPABASE_PUBLISHABLE_KEY: SERVICE },
      serviceRoleValues: [SERVICE],
    });
    expect(r.ok).toBe(false);
  });

  it("does not treat empty service-role slot as a match for empty VITE_ values", () => {
    const r = sanitizeChildEnv({
      parentEnv: { VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      overlay: {},
      serviceRoleValues: ["", ""],
    });
    expect(r.ok).toBe(true);
  });

  it("passes clean env unchanged (VITE_ publishable + non-VITE parent vars)", () => {
    const r = sanitizeChildEnv({
      parentEnv: { PATH: "/usr/bin", HOME: "/root" },
      overlay: {
        SUPABASE_URL: "https://test-abcdef.supabase.co",
        VITE_SUPABASE_URL: "https://test-abcdef.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_value",
      },
      serviceRoleValues: [SERVICE],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_safe_value");
      expect(r.env.PATH).toBe("/usr/bin");
    }
  });
});
