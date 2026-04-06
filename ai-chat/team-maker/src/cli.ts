import { evaluate } from "./core/evaluator";
import { toMarkdown } from "./core/format";
import type { EvaluateRequest } from "./core/schema";

const args = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1] || fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

if (hasFlag("help") || args[0] === "help") {
  console.log(`
team-maker CLI — decompose project plans into agent & team prompts

Usage:
  bun run src/cli.ts evaluate --file <path> [options]
  bun run src/cli.ts evaluate --stdin [options]
  bun run src/cli.ts export --input <json> --output <path> [--format markdown|json]

Evaluate options:
  --file <path>          Path to plan file (.md, .txt, .json)
  --stdin                Read plan from stdin
  --agents <n>           Number of AI agents (default: 3)
  --humans <n>           Number of human team members (default: 2)
  --provider <name>      LLM provider (default: from env)
  --model <name>         Model name (default: from env)
  --style <concise|detailed>   Prompt style (default: concise)
  --strategy <balanced|specialized>  Allocation strategy (default: balanced)
  --format <json|markdown>     Output format (default: markdown)
  --output <path>        Write output to file instead of stdout
  --help                 Show this help
`);
  process.exit(0);
}

const command = args[0];

if (command === "evaluate") {
  await runEvaluate();
} else if (command === "export") {
  await runExport();
} else {
  console.error(`Unknown command: ${command || "(none)"}. Use --help for usage.`);
  process.exit(1);
}

async function runEvaluate() {
  let plan: string;

  if (hasFlag("stdin")) {
    plan = await readStdin();
  } else {
    const filePath = flag("file");
    if (!filePath) {
      console.error("Provide --file <path> or --stdin");
      process.exit(1);
    }
    plan = await Bun.file(filePath).text();
  }

  if (!plan.trim()) {
    console.error("Plan is empty");
    process.exit(1);
  }

  const request: EvaluateRequest = {
    plan,
    aiAgentCount: Number(flag("agents", "3")),
    humanCount: Number(flag("humans", "2")),
    provider: flag("provider") as EvaluateRequest["provider"],
    model: flag("model"),
    promptStyle: (flag("style", "concise") as EvaluateRequest["promptStyle"]),
    allocationStrategy: (flag("strategy", "balanced") as EvaluateRequest["allocationStrategy"]),
    includeRisks: true,
    includeDependencies: true,
  };

  console.error(`[team-maker] Evaluating plan (${plan.length} chars)...`);
  console.error(`[team-maker] ${request.aiAgentCount} AI agents, ${request.humanCount} humans`);

  try {
    const { response, validation } = await evaluate(request);
    const format = flag("format", "markdown");
    const outputPath = flag("output");

    let output: string;
    if (format === "json") {
      output = JSON.stringify({ ...response, validation }, null, 2);
    } else {
      output = toMarkdown(response, validation);
    }

    if (outputPath) {
      await Bun.write(outputPath, output);
      console.error(`[team-maker] Written to ${outputPath}`);
    } else {
      console.log(output);
    }

    if (validation.warnings.length > 0) {
      console.error(`\n[team-maker] ${validation.warnings.length} warning(s):`);
      for (const w of validation.warnings) {
        console.error(`  - ${w}`);
      }
    }

    if (response.usage) {
      console.error(
        `[team-maker] Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`
      );
    }
  } catch (err) {
    console.error(`[team-maker] Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function runExport() {
  const inputPath = flag("input");
  if (!inputPath) {
    console.error("Provide --input <path> to a JSON result file");
    process.exit(1);
  }

  const data = JSON.parse(await Bun.file(inputPath).text());
  const format = flag("format", "markdown");
  const outputPath = flag("output");

  let output: string;
  if (format === "json") {
    output = JSON.stringify(data, null, 2);
  } else {
    output = toMarkdown(data);
  }

  if (outputPath) {
    await Bun.write(outputPath, output);
    console.error(`[team-maker] Exported to ${outputPath}`);
  } else {
    console.log(output);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
