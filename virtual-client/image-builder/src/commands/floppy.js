import { Command } from "commander";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { run } from "../lib/exec.js";
import { walkFiles } from "../lib/fswalk.js";
import { requireTools } from "../lib/validate.js";
import { writeManifest } from "../lib/manifest.js";

export function cmdFloppy() {
  const cmd = new Command("floppy");

  cmd
    .description("Build a v86 floppy image (.img, FAT12) from a directory")
    .requiredOption("-i, --input <dir>", "Input directory to pack into the floppy")
    .requiredOption("-o, --output <file>", "Output floppy image path, e.g. out/boot.img")
    .option("--label <name>", "Volume label", "V86FLOPPY")
    .option("--size <kb>", "Floppy size in KB (default 1440 for 1.44MB)", "1440")
    .option("--manifest-dir <dir>", "Directory to write manifest.json", "out")
    .action(async (opts) => {
      await requireTools(["mformat", "mcopy"]);

      const inputDir = path.resolve(opts.input);
      const outImg = path.resolve(opts.output);
      const outDir = path.dirname(outImg);
      await mkdir(outDir, { recursive: true });

      // Create empty floppy image file of given size
      const sizeKB = Number(opts.size);
      if (!Number.isFinite(sizeKB) || sizeKB <= 0) {
        throw new Error(`Invalid --size: ${opts.size}`);
      }

      // dd if=/dev/zero of=... bs=1024 count=...
      await run("dd", ["if=/dev/zero", `of=${outImg}`, "bs=1024", `count=${sizeKB}`]);

      // Format FAT12 using mtools "mformat"
      // -i image ::  indicates root
      await run("mformat", ["-i", outImg, "-f", "1440", "-v", opts.label, "::"]);

      // Copy files preserving directory structure:
      // mcopy -i image -s input/* ::
      // But we need to ensure dotfiles too; we'll iterate.
      // mtools expects DOS-ish paths; simplest is to copy whole dir with -s from within input.
      await run("mcopy", ["-i", outImg, "-s", path.join(inputDir, "*"), "::/"]);

      // Also copy dotfiles (mcopy glob won't match). We’ll explicitly walk and copy them.
      for await (const file of walkFiles(inputDir)) {
        const rel = path.relative(inputDir, file);
        if (!rel.startsWith(".")) continue; // only dotpaths
        const dosPath = rel.split(path.sep).join("/");
        // Ensure parent directories exist in image: mmd -i img ::/a/b
        const parent = path.posix.dirname(dosPath);
        if (parent && parent !== ".") {
          // create directories progressively
          const parts = parent.split("/");
          let cur = "";
          for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            try { await run("mmd", ["-i", outImg, `::/${cur}`]); } catch {}
          }
        }
        await run("mcopy", ["-i", outImg, file, `::/${parent === "." ? "" : parent}/`]);
      }

      const manifestPath = await writeManifest(path.resolve(opts.manifestDir), {
        kind: "floppy",
        output: outImg,
        input: inputDir,
        format: "fat12",
        v86: { fda: outImg }
      });

      console.log(`Built floppy image: ${outImg}`);
      console.log(`Wrote manifest: ${manifestPath}`);
    });

  return cmd;
}