#!/usr/bin/env bun
import { Command } from "commander";
import { cmdFloppy } from "./commands/floppy.js";
import { cmdHdd } from "./commands/hdd.js";
import { cmdIso } from "./commands/iso.js";

const program = new Command();

program
  .name("v86img")
  .description("Build v86-compatible OS images (floppy/hdd/iso) using Bun as the orchestrator.")
  .version("0.1.0");

program.addCommand(cmdFloppy());
program.addCommand(cmdHdd());
program.addCommand(cmdIso());

program.parse(process.argv);