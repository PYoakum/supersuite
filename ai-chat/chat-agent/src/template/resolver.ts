const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function resolveTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(TOKEN_RE, (_, key) =>
    variables[key] !== undefined ? variables[key] : `{{${key}}}`
  );
}

export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE);
  while ((m = re.exec(template)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      vars.push(m[1]);
    }
  }
  return vars;
}
