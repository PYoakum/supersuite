// ── Normalized project plan (internal representation) ──

export interface ProjectPlan {
  title?: string;
  summary?: string;
  goals: string[];
  constraints: string[];
  milestones: Milestone[];
  workstreams: Workstream[];
  tasks: Task[];
  assumptions: string[];
  risks: string[];
  dependencies: Dependency[];
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  date?: string;
}

export interface Workstream {
  id: string;
  title: string;
  description?: string;
  taskIds: string[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  workstream?: string;
  dependencies?: string[];
  deliverables?: string[];
  suggestedOwnerType?: "ai" | "human" | "either";
  priority?: "low" | "medium" | "high";
}

export interface Dependency {
  from: string;
  to: string;
  type?: "blocks" | "informs" | "requires";
}

// ── Request/response shapes ──

export interface EvaluateRequest {
  plan: string;
  format?: "text" | "markdown" | "json";
  aiAgentCount: number;
  humanCount: number;
  model?: string;
  provider?: "anthropic" | "openai" | "gemini" | "openai-compat";
  promptStyle?: "concise" | "detailed";
  allocationStrategy?: "specialized" | "balanced";
  includeRisks?: boolean;
  includeDependencies?: boolean;
}

export interface LLMConfig {
  provider: "anthropic" | "openai" | "gemini" | "openai-compat";
  model: string;
  baseUrl?: string;
}

export interface RoleAssignment {
  roleId: string;
  displayName?: string;
  avatar?: string;
  roleType: "ai" | "human";
  roleKind?: "worker" | "pm" | "human";
  focus: string;
  taskIds: string[];
  managedBy?: string;
  manages?: string[];
  skills?: string[];
  tools?: string[];
  llm?: LLMConfig;
}

export interface GeneratedPrompt {
  roleId: string;
  displayName?: string;
  avatar?: string;
  roleType: "ai" | "human";
  roleKind?: "worker" | "pm" | "human";
  prompt: string;
  skills?: string[];
  tools?: string[];
  llm?: LLMConfig;
}

export interface PatchRolesRequest {
  roles: {
    roleId: string;
    llm: LLMConfig;
  }[];
}

export interface CoverageReport {
  coveredTaskIds: string[];
  uncoveredTaskIds: string[];
  notes: string[];
}

export interface EvaluateResponse {
  summary: string;
  tasks: Task[];
  assignments: RoleAssignment[];
  prompts: GeneratedPrompt[];
  coverageReport: CoverageReport;
  ambiguities: string[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
