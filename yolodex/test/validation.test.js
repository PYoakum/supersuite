import { describe, test, expect } from "bun:test";
import { validate, required, isEmail, isNumeric, min, oneOf } from "../server/lib/validation.js";

describe("Validation", () => {
  test("required rejects empty values", () => {
    const errors = validate({ name: "" }, { name: [required()] });
    expect(errors).not.toBeNull();
    expect(errors.name).toBe("This field is required");
  });

  test("required accepts non-empty values", () => {
    const errors = validate({ name: "Alice" }, { name: [required()] });
    expect(errors).toBeNull();
  });

  test("isEmail rejects invalid emails", () => {
    const errors = validate({ email: "notanemail" }, { email: [isEmail()] });
    expect(errors).not.toBeNull();
  });

  test("isEmail accepts valid emails", () => {
    const errors = validate({ email: "test@example.com" }, { email: [isEmail()] });
    expect(errors).toBeNull();
  });

  test("isNumeric rejects non-numbers", () => {
    const errors = validate({ amount: "abc" }, { amount: [isNumeric()] });
    expect(errors).not.toBeNull();
  });

  test("min rejects values below minimum", () => {
    const errors = validate({ amount: "0" }, { amount: [isNumeric(), min(0.01)] });
    expect(errors).not.toBeNull();
  });

  test("oneOf rejects invalid choices", () => {
    const errors = validate({ role: "superadmin" }, { role: [oneOf(["admin", "staff", "readonly"])] });
    expect(errors).not.toBeNull();
  });

  test("multiple fields validated together", () => {
    const errors = validate(
      { email: "", amount: "abc" },
      {
        email: [required("Email required")],
        amount: [required(), isNumeric()],
      }
    );
    expect(errors).not.toBeNull();
    expect(errors.email).toBe("Email required");
    expect(errors.amount).toBe("Must be a number");
  });
});

describe("Template helpers", () => {
  test("escapeHtml prevents XSS", async () => {
    const { escapeHtml } = await import("../server/lib/templates.js");
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  test("escapeHtml handles null/undefined", async () => {
    const { escapeHtml } = await import("../server/lib/templates.js");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
