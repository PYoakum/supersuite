// Light-touch persona consistency checker.
// Flags messages from agents that refer to the user in third person
// when second person ("you") would be more appropriate.

const THIRD_PERSON_PATTERNS = [
  /\bthe user\b/i,
  /\bthe human\b/i,
  /\bthe client\b/i,
  /\bthe supervisor\b/i,
  /\bhe\/she\b/i,
  /\bhe or she\b/i,
];

export interface PersonaCheckResult {
  consistent: boolean;
  warnings: string[];
}

export function checkPersonaConsistency(content: string, senderType: string): PersonaCheckResult {
  if (senderType !== "agent") {
    return { consistent: true, warnings: [] };
  }

  const warnings: string[] = [];

  for (const pattern of THIRD_PERSON_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(
        `Detected third-person reference matching "${pattern.source}". ` +
        `Prefer second-person ("you") when referring to the user.`
      );
    }
  }

  return {
    consistent: warnings.length === 0,
    warnings,
  };
}
