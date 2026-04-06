Below is a project plan you can hand to an LLM for execution.

---

# Project Plan: Bun-Based CLI + Web App for Project Plan Decomposition into AI Agent and Team Prompts

## 1. Project Overview

Build a combined **CLI tool** and **web application** using the **Bun runtime** that accepts a project plan as input, evaluates it with an LLM, and generates a concise, actionable set of prompts for a configurable number of:

* **AI agents**
* **Human team members**

The generated prompts must collectively cover the full scope of the project’s tasks, responsibilities, dependencies, and expected deliverables.

The system should help a user turn a high-level plan into an execution-ready coordination layer for mixed human/AI teams.

---

## 2. Core Objective

Given a project plan, the application should:

1. Ingest the plan from CLI input, uploaded file, pasted text, or web form.
2. Normalize and parse the plan into structured units.
3. Send the normalized plan to an LLM for evaluation.
4. Ask the LLM to:

   * identify goals, workstreams, milestones, risks, dependencies, and deliverables
   * decompose the plan into tasks and responsibilities
   * allocate those responsibilities across a configurable number of AI agents and human team members
   * generate a short prompt for each agent and each team member
5. Return outputs in a form suitable for immediate execution, review, and export.

---

## 3. Product Scope

### In Scope

* Bun-based monorepo or unified app
* Shared core logic between CLI and web app
* Project plan ingestion via text and files
* LLM-powered evaluation and decomposition
* Configurable number of AI agents
* Configurable number of human team members
* Prompt generation for each role
* Structured JSON output
* Human-readable output
* Export support
* Basic run history and reproducibility

### Out of Scope for V1

* Real-time multi-agent orchestration
* Agent execution engine
* Fine-grained PM tooling integrations
* Authentication with enterprise IAM
* Billing or multi-tenant SaaS concerns
* Full Gantt or timeline management

---

## 4. Primary Use Cases

### Use Case 1: CLI Planning

A user runs a CLI command with a markdown or text project plan and requests prompts for 4 AI agents and 3 team members.

### Use Case 2: Browser Workflow

A user pastes a project plan into the web UI, selects the number of agents and human contributors, chooses an LLM model, and reviews the generated assignments.

### Use Case 3: Structured Export

A user exports the result as JSON or Markdown for downstream execution in another workflow.

### Use Case 4: Iterative Refinement

A user tweaks the configuration or clarifies project constraints and regenerates prompts.

---

## 5. Functional Requirements

## 5.1 Input Ingestion

The app must support:

* raw pasted text
* markdown files
* plain text files
* optional JSON project plans
* CLI stdin
* drag-and-drop or upload in web UI

The ingestion layer should:

* preserve section hierarchy where possible
* detect headings, bullets, milestones, dates, owners, and dependencies
* normalize content into an internal schema

---

## 5.2 Configuration

The user must be able to configure:

* number of AI agents
* number of human team members
* model provider
* model name
* prompt style
* output format
* verbosity
* decomposition strategy
* whether to prefer specialization or balanced load
* whether to include risks, dependencies, and assumptions in each generated prompt

Configuration must be supported by:

* CLI flags
* config file
* web form

---

## 5.3 LLM Evaluation

The system must send the plan to an LLM with instructions to:

* evaluate completeness of the plan
* identify ambiguities and gaps
* derive a structured task model
* map tasks to roles
* ensure coverage across all responsibilities
* avoid overlap unless collaboration is required
* produce concise role-specific prompts

The LLM response should include:

* summary of project
* task inventory
* workstream grouping
* dependency map
* identified risks and unknowns
* assignment plan
* prompt per AI agent
* prompt per human team member
* coverage check

---

## 5.4 Output Generation

The system must generate:

### Human-readable output

* project summary
* assignment overview
* agent prompts
* team member prompts
* uncovered gaps or ambiguities

### Structured output

* JSON schema for machine use
* Markdown export for humans

Optional:

* CSV export of assignments
* copy-to-clipboard support in web UI

---

## 5.5 Validation

The app must validate that:

* every major task is assigned
* dependencies are represented
* prompts are not redundant
* role count constraints are respected
* output is syntactically valid JSON when requested

---

## 6. Non-Functional Requirements

* Written for Bun runtime
* Fast startup and low overhead
* Shared code between CLI and web app
* Deterministic output mode where possible
* Clear error handling
* Logging for requests and failures
* Pluggable provider abstraction for LLM backends
* Testable parsing and prompt generation layers
* Secure handling of API keys
* Minimal dependencies where practical

---

## 7. Proposed Architecture

## 7.1 High-Level Components

### 1. Shared Core Library

Contains:

* plan ingestion
* normalization
* schema definitions
* LLM prompt construction
* response parsing
* validation
* formatting/export

### 2. CLI Application

Provides:

* file and stdin input
* config flags
* terminal rendering
* export commands

### 3. Web Application

Provides:

* browser UI
* form-based configuration
* text editor / file upload
* results viewer
* export actions

### 4. API Layer

Used by web app for:

* submitting plans
* invoking LLM pipeline
* returning structured results

### 5. LLM Provider Adapter

Abstracts:

* OpenAI-compatible APIs
* possible future providers
* retries, timeouts, model-specific settings

---

## 7.2 Suggested Directory Structure

```text
project-root/
  package.json
  bunfig.toml
  tsconfig.json

  src/
    core/
      schema/
        project-plan.ts
        evaluation.ts
        assignments.ts
      ingest/
        text-parser.ts
        markdown-parser.ts
        json-parser.ts
        normalize.ts
      llm/
        provider.ts
        prompt-builder.ts
        response-parser.ts
        evaluator.ts
      validation/
        coverage-check.ts
        schema-check.ts
      format/
        markdown.ts
        json.ts
        terminal.ts
      config/
        defaults.ts
        loader.ts

    cli/
      index.ts
      commands/
        evaluate.ts
        export.ts

    web/
      server.ts
      routes/
        evaluate.ts
        health.ts
      ui/
        index.html
        app.tsx
        components/
          plan-input.tsx
          config-form.tsx
          results-view.tsx

    shared/
      types.ts
      constants.ts
      errors.ts

  tests/
    unit/
    integration/
    fixtures/
```

---

## 8. Internal Data Model

Define a normalized internal schema such as:

```ts
type ProjectPlan = {
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
};

type Task = {
  id: string;
  title: string;
  description?: string;
  workstream?: string;
  dependencies?: string[];
  deliverables?: string[];
  suggestedOwnerType?: "ai" | "human" | "either";
  priority?: "low" | "medium" | "high";
};

type AssignmentRequest = {
  aiAgentCount: number;
  humanCount: number;
  model: string;
  promptStyle: "concise" | "detailed";
  allocationStrategy: "specialized" | "balanced";
};

type AssignmentOutput = {
  summary: string;
  tasks: Task[];
  assignments: RoleAssignment[];
  prompts: GeneratedPrompt[];
  coverageReport: CoverageReport;
  ambiguities: string[];
};
```

---

## 9. LLM Workflow Design

## 9.1 Stage 1: Normalize Input

Convert raw project plan input into a consistent structured representation.

## 9.2 Stage 2: Evaluate Plan

Send the normalized content to the LLM and request:

* project summary
* decomposition into tasks
* dependency analysis
* missing information
* recommended staffing split

## 9.3 Stage 3: Allocate Work

Prompt the model to distribute work across the requested number of AI agents and human team members.

Rules:

* all major tasks must be covered
* balance workload where possible
* assign humans where judgment, approvals, external communication, or accountability are needed
* assign AI where synthesis, drafting, coding, analysis, and repetitive transformation are appropriate

## 9.4 Stage 4: Generate Prompts

Generate one short prompt for each role.

Each prompt should include:

* role name
* mission
* owned tasks
* dependencies
* expected outputs
* collaboration points
* success criteria
* constraints

## 9.5 Stage 5: Coverage Check

Ask the LLM or local validator to verify:

* no major task omitted
* no role idle
* no critical dependency ignored
* no prompt too vague to execute

---

## 10. Prompt Engineering Requirements

The system prompt for the LLM should instruct it to:

* act as a project decomposition and staffing planner
* preserve complete task coverage
* avoid hallucinating unknown project facts
* explicitly mark assumptions
* produce concise but actionable prompts
* clearly distinguish AI-agent responsibilities from human responsibilities
* provide structured JSON matching a schema

The application should use:

* schema-constrained output where supported
* fallback parsing and repair logic when needed
* retry strategy on malformed responses

---

## 11. CLI Design

## 11.1 Example Commands

```bash
bun run cli evaluate --file ./plan.md --agents 4 --humans 3
bun run cli evaluate --stdin --agents 2 --humans 2 --format markdown
bun run cli export --input ./result.json --output ./result.md
```

## 11.2 CLI Features

* read file or stdin
* validate config
* show summary in terminal
* optionally write JSON or Markdown output to file
* support non-interactive scripting
* return non-zero exit codes on failures

---

## 12. Web App Design

## 12.1 Main Screens

### Input Screen

* paste plan
* upload file
* configure counts and model
* choose output style

### Results Screen

* summary panel
* assignments by role
* prompts per AI agent
* prompts per human
* gaps and warnings
* export buttons

### History Screen

* recent runs
* compare regenerated outputs

---

## 12.2 UI Components

* multiline editor
* file uploader
* config form
* results cards
* JSON viewer
* Markdown preview
* coverage report panel

---

## 13. API Design

### POST `/api/evaluate`

Request:

* raw plan or structured plan
* configuration

Response:

* normalized plan
* evaluation summary
* assignments
* prompts
* coverage report
* warnings

### GET `/api/health`

Basic health check.

Optional:

### POST `/api/export`

Generate downloadable export formats.

---

## 14. LLM Provider Abstraction

Create a provider interface:

```ts
interface LlmProvider {
  evaluateProjectPlan(input: {
    normalizedPlan: ProjectPlan;
    request: AssignmentRequest;
  }): Promise<AssignmentOutput>;
}
```

Implement:

* OpenAI-compatible provider first
* provider-specific config via environment variables
* retry and timeout wrapper

---

## 15. Error Handling Plan

Handle these cases:

* unsupported file type
* invalid config
* missing API key
* LLM timeout
* malformed LLM output
* partial coverage in returned assignments
* token budget overflow for very large plans

For oversized inputs:

* chunk plan by workstream
* summarize locally or with a first-pass LLM call
* then run decomposition on condensed plan

---

## 16. Security Considerations

* API keys stored in environment variables
* no secrets exposed to client
* sanitize uploaded content
* set request size limits
* validate all server inputs
* strip executable content from uploads where appropriate
* log minimally and avoid storing sensitive plan contents unless explicitly enabled

---

## 17. Testing Strategy

## 17.1 Unit Tests

Cover:

* input parsing
* normalization
* config loading
* response parsing
* schema validation
* coverage validation

## 17.2 Integration Tests

Cover:

* CLI end-to-end flow
* API route behavior
* mock LLM provider execution
* export generation

## 17.3 Fixture Tests

Use sample plans:

* software project
* marketing launch
* research project
* operations migration

Verify:

* all tasks covered
* correct number of prompts produced
* output stable enough for review

---

## 18. Milestones

## Milestone 1: Project Setup

* initialize Bun project
* define shared schemas
* build config system
* scaffold CLI and web app

## Milestone 2: Ingestion + Normalization

* implement text/markdown/json ingestion
* build parser and internal schema
* add tests

## Milestone 3: LLM Evaluation Pipeline

* implement provider adapter
* build prompts
* parse structured responses
* add retries and validation

## Milestone 4: CLI UX

* complete CLI commands
* terminal formatting
* file export

## Milestone 5: Web App UX

* input form
* results view
* API integration
* export actions

## Milestone 6: Validation + Hardening

* coverage checker
* malformed-output repair
* logging
* final tests

---

## 19. Deliverables

The final implementation should produce:

* Bun-based CLI tool
* Bun-based web app
* shared TypeScript core library
* prompt templates
* provider abstraction
* JSON schema for outputs
* Markdown export support
* test suite
* sample fixtures
* README with usage examples

---

## 20. Acceptance Criteria

The project is complete when:

1. A user can provide a project plan through CLI or web UI.
2. A user can specify the number of AI agents and human team members.
3. The system sends the plan to an LLM and receives a structured evaluation.
4. The system returns concise prompts for every requested role.
5. All major tasks and responsibilities in the input plan are covered.
6. The result can be exported as JSON and Markdown.
7. Shared logic is reused across CLI and web app.
8. Tests validate parsing, generation, and assignment coverage.

---

## 21. Suggested Execution Order for the Implementing LLM

1. Scaffold Bun project and directory structure.
2. Define TypeScript schemas for normalized plan and assignment output.
3. Implement config loading and environment handling.
4. Implement ingestion for text, markdown, and JSON.
5. Build normalization pipeline.
6. Implement LLM provider interface and first provider.
7. Create prompt builder and structured response parser.
8. Implement coverage validation logic.
9. Build CLI commands and terminal output formatter.
10. Build HTTP API routes for the web app.
11. Build simple web UI for input, config, and results.
12. Add export support.
13. Write tests using fixtures.
14. Document usage and architecture.

---

## 22. Recommended V1 Output Shape

The LLM should return something close to:

```json
{
  "summary": "Short project summary",
  "tasks": [
    {
      "id": "T1",
      "title": "Define requirements",
      "workstream": "Planning",
      "dependencies": [],
      "deliverables": ["Requirements document"]
    }
  ],
  "assignments": [
    {
      "roleId": "AI-1",
      "roleType": "ai",
      "focus": "Requirements analysis and decomposition",
      "taskIds": ["T1"]
    },
    {
      "roleId": "H-1",
      "roleType": "human",
      "focus": "Stakeholder validation and approvals",
      "taskIds": ["T1"]
    }
  ],
  "prompts": [
    {
      "roleId": "AI-1",
      "prompt": "You are AI Agent 1. Analyze the project requirements, break them into actionable tasks, identify gaps, and produce a structured requirements draft..."
    }
  ],
  "coverageReport": {
    "coveredTaskIds": ["T1"],
    "uncoveredTaskIds": [],
    "notes": []
  },
  "ambiguities": ["Timeline is not fully specified"]
}
```

---

## 23. Implementation Notes for the LLM

* Prefer TypeScript throughout.
* Use Bun-native tooling where practical.
* Keep parsing and provider logic decoupled from presentation layers.
* Design for deterministic validation even if LLM output varies.
* Keep generated prompts short, specific, and role-bound.
* Favor structured outputs first, formatted views second.
