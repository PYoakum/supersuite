/**
 * Lightweight validation helpers.
 *
 * Usage:
 *   const errors = validate(body, {
 *     email:  [required("Email is required"), isEmail("Must be a valid email")],
 *     amount: [required(), isNumeric(), min(0.01)],
 *   });
 *   if (errors) return renderFormWithErrors(errors);
 */

export function validate(data, rules) {
  const errors = {};
  let hasErrors = false;

  for (const [field, validators] of Object.entries(rules)) {
    const value = data[field];
    for (const validator of validators) {
      const msg = validator(value, data);
      if (msg) {
        errors[field] = msg;
        hasErrors = true;
        break; // first error wins per field
      }
    }
  }

  return hasErrors ? errors : null;
}

/** Field is required (non-empty after trim) */
export function required(msg = "This field is required") {
  return (value) => {
    if (value == null || String(value).trim() === "") return msg;
    return null;
  };
}

/** Must be a valid email format */
export function isEmail(msg = "Must be a valid email address") {
  return (value) => {
    if (!value) return null; // let required() handle empty
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) return msg;
    return null;
  };
}

/** Must be numeric */
export function isNumeric(msg = "Must be a number") {
  return (value) => {
    if (value == null || value === "") return null;
    if (isNaN(Number(value))) return msg;
    return null;
  };
}

/** Minimum numeric value */
export function min(minVal, msg) {
  return (value) => {
    if (value == null || value === "") return null;
    if (Number(value) < minVal) return msg || `Must be at least ${minVal}`;
    return null;
  };
}

/** Maximum string length */
export function maxLength(max, msg) {
  return (value) => {
    if (value == null) return null;
    if (String(value).length > max) return msg || `Must be at most ${max} characters`;
    return null;
  };
}

/** Must be one of allowed values */
export function oneOf(allowed, msg) {
  return (value) => {
    if (value == null || value === "") return null;
    if (!allowed.includes(value)) return msg || `Must be one of: ${allowed.join(", ")}`;
    return null;
  };
}

/** Must be a valid date string */
export function isDate(msg = "Must be a valid date") {
  return (value) => {
    if (value == null || value === "") return null;
    if (isNaN(Date.parse(value))) return msg;
    return null;
  };
}
