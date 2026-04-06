import { Command } from "commander";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { run, which } from "../lib/exec.js";
import { requireTools } from "../lib/validate.js";
import { writeManifest } from "../lib/manifest.js";

export function cmdIso() {
  const cmd = new Command("iso");

  cmd
    .description("Build an ISO image (.iso) from a directory (for v86 cdrom)")
    .requiredOption("-i, --input <dir>", "Input directory to pack into the ISO")
    .requiredOption("-o, --output <file>", "Output ISO path, e.g. out/cdrom.iso")
    .option("--label <name>", "ISO volume label", "V86ISO")
    .option("--manifest-dir <dir>", "Directory to write manifest.json", "out")
    .action(async (opts) => {
      const inputDir = path.resolve(opts.input);
      const outIso = path.resolve(opts.output);
      await mkdir(path.dirname(outIso), { recursive: true });

      const hasXorriso = await which("xorriso");
      const hasGeniso = await which("genisoimage") || await which("mkisofs");

      if (!hasXorriso && !hasGeniso) {
        await requireTools(["xorriso"]); // will throw with message
      }

      if (hasXorriso) {
        // xorriso -as mkisofs -o out.iso -V LABEL -J -R inputDir
        await run("xorriso", [
          "-as", "mkisofs",
          "-o", outIso,
          "-V", opts.label,
          "-J", "-R",
          inputDir,
        ]);
      } else {
        const gen = (await which("genisoimage")) ? "genisoimage" : "mkisofs";
        await run(gen, ["-o", outIso, "-V", opts.label, "-J", "-R", inputDir]);
      }

      const manifestPath = await writeManifest(path.resolve(opts.manifestDir), {
        kind: "iso",
        output: outIso,
        input: inputDir,
        format: "iso9660",
        v86: { cdrom: outIso }
      });

      console.log(`Built ISO: ${outIso}`);
      console.log(`Wrote manifest: ${manifestPath}`);
    });

  return cmd;
}