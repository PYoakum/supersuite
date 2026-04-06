import { join } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { getLastResult } from "./roles";

const SKILLS_DIR = join(import.meta.dir, "..", "..", "skills");

/** In-memory skill assignments: roleId -> skill filenames */
const skillAssignments = new Map<string, string[]>();

function ensureSkillsDir() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
}

/** List available skill files in the skills/ directory. */
export function handleListSkills(): Response {
  ensureSkillsDir();

  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  const skills = files.map((filename) => {
    const fullPath = join(SKILLS_DIR, filename);
    const content = readFileSync(fullPath, "utf-8");
    const heading = content.match(/^#\s+(.+)/m);
    const stat = statSync(fullPath);
    return {
      filename,
      title: heading?.[1] || filename.replace(/\.md$/, ""),
      size: stat.size,
    };
  });

  return Response.json({ ok: true, skills });
}

/** Assign skill files to a role. */
export async function handleAssignSkills(req: Request): Promise<Response> {
  let body: { roleId: string; skills: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.roleId || !Array.isArray(body.skills)) {
    return Response.json(
      { ok: false, errors: ["roleId (string) and skills (string[]) are required"] },
      { status: 400 },
    );
  }

  ensureSkillsDir();

  // Validate all skill files exist
  const missing = body.skills.filter(
    (f) => !existsSync(join(SKILLS_DIR, f)),
  );
  if (missing.length > 0) {
    return Response.json(
      { ok: false, errors: [`Skill files not found: ${missing.join(", ")}`] },
      { status: 400 },
    );
  }

  skillAssignments.set(body.roleId, [...body.skills]);

  // Also update the in-memory lastResult if it exists
  const lastResult = getLastResult();
  if (lastResult) {
    const assignment = lastResult.assignments.find((a) => a.roleId === body.roleId);
    if (assignment) assignment.skills = [...body.skills];
    const prompt = lastResult.prompts.find((p) => p.roleId === body.roleId);
    if (prompt) prompt.skills = [...body.skills];
  }

  return Response.json({ ok: true, roleId: body.roleId, skills: body.skills });
}

/** Get all skill assignments. */
export function handleGetSkillAssignments(): Response {
  const assignments: Record<string, string[]> = {};
  for (const [roleId, skills] of skillAssignments) {
    assignments[roleId] = skills;
  }
  return Response.json({ ok: true, assignments });
}

/** Set skill assignments for a role programmatically. */
export function setSkillsForRole(roleId: string, skills: string[]): void {
  skillAssignments.set(roleId, skills);
}

/** Get skill filenames for a given role. */
export function getSkillsForRole(roleId: string): string[] {
  return skillAssignments.get(roleId) || [];
}

/** Read a skill file's content. Returns empty string if not found. */
export function loadSkillContent(filename: string): string {
  const fullPath = join(SKILLS_DIR, filename);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf-8");
}
