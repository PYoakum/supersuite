import { Command } from "commander";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { run, which } from "../lib/exec.js";
import { requireTools } from "../lib/validate.js";
import { writeManifest } from "../lib/manifest.js";

export function cmdHdd() {
  const cmd = new Command("hdd");

  cmd
    .description("Build a v86 hard disk image (.img, ext2) from a directory")
    .requiredOption("-i, --input <dir>", "Input directory to copy into the filesystem")
    .requiredOption("-o, --output <file>", "Output HDD image path, e.g. out/root.img")
    .option("--size <mb>", "Disk size in MB", "64")
    .option("--label <name>", "Filesystem label", "V86ROOT")
    .option("--manifest-dir <dir>", "Directory to write manifest.json", "out")
    .action(async (opts) => {
      await requireTools(["dd", "mkfs.ext2"]);

      const inputDir = path.resolve(opts.input);
      const outImg = path.resolve(opts.output);
      const outDir = path.dirname(outImg);
      await mkdir(outDir, { recursive: true });

      const sizeMB = Number(opts.size);
      if (!Number.isFinite(sizeMB) || sizeMB <= 0) {
        throw new Error(`Invalid --size: ${opts.size}`);
      }

      // Create raw file
      await run("dd", ["if=/dev/zero", `of=${outImg}`, "bs=1m", `count=${sizeMB}`]);

      // Make ext2 filesystem
      await run("mkfs.ext2", ["-F", "-L", opts.label, outImg]);

      // Copy files into ext2 without mounting:
      // Prefer e2tools (e2mkdir/e2cp). If not available, fallback to debugfs.
      const hasE2cp = await which("e2cp");
      const hasE2mkdir = await which("e2mkdir");
      const hasDebugfs = await which("debugfs");

      if (hasE2cp && hasE2mkdir) {
        // Use e2tools
        // Create root dirs and copy recursively by using a tar stream into a temp dir is awkward,
        // so we use "e2cp -r" if available (varies). We'll do a pragmatic approach:
        await run("e2mkdir", [outImg, ":/"]);
        // e2cp -r <inputDir>/* <img>:/   (may not copy dotfiles)
        await run("e2cp", ["-r", path.join(inputDir, "*"), `${outImg}:/`]).catch(async () => {
          throw new Error(
            "e2cp exists but recursive copy failed. Install e2tools that supports -r, or ensure debugfs is available."
          );
        });
      } else if (hasDebugfs) {
        // debugfs can write files; for directories, we can use its 'rdump' command.
        // debugfs -w -R "rdump <hostdir> /" image
        await run("debugfs", ["-w", "-R", `rdump ${inputDir} /`, outImg]);
      } else {
        throw new Error(
          "Need either e2tools (e2cp/e2mkdir) or debugfs to copy files into ext2 image."
        );
      }

      const manifestPath = await writeManifest(path.resolve(opts.manifestDir), {
        kind: "hdd",
        output: outImg,
        input: inputDir,
        format: "ext2",
        v86: { hda: outImg }
      });

      console.log(`Built HDD image: ${outImg}`);
      console.log(`Wrote manifest: ${manifestPath}`);
    });

  return cmd;
}