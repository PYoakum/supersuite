import { SandboxManager } from "./sandbox";
import { ToolRouter } from "./router";

// ── Core tools ─────────────────────────────────────────────
import codeEditor from "./code-editor";
import fileCreate from "./file-create";
import httpRequest from "./http-request";
import bashCommand from "./bash-command";
import jsExecute from "./js-execute";
import pythonRunner from "./python-runner";
import sqliteTool from "./sqlite-query";
import readFile from "./read-file";
import projectScaffold from "./project-scaffold";
import netTools from "./net-tools";
import gitHost from "./git-host";
import calendar from "./calendar";

// ── Extended tools (all TypeScript) ────────────────────────
import analyzeResearch from "./analyze-research";
import browserRequest from "./browser-request";
import composeEmail from "./compose-email";
import createImage from "./create-image";
import tablemaker from "./tablemaker";
import tcpConnect from "./tcp-connect";
import createMesh from "./create-mesh";
import contextResearchBrowser from "./context-research-browser";
import frameworkExec from "./framework-exec";
import golangExec from "./golang-exec";
import editAudio from "./edit-audio";
import audioCleanup from "./audio-cleanup";
import createDrum from "./create-drum";
import createObj from "./create-obj";
import midiMp3 from "./midi-mp3";
import tts from "./tts";
import stt from "./stt";
import voiceClone from "./voice-clone";
import pdfExport from "./pdf-export";
import docxMd from "./docx-md";
import mdDocx from "./md-docx";
import personaCompose from "./persona-compose";
import readEmail from "./read-email";
import reviewResearch from "./review-research";
import tokenReplace from "./token-replace";
import chatModeration from "./chat-moderation";
import postImage from "./post-image";
import postVoiceNote from "./post-voice-note";
import readChatLogs from "./read-chat-logs";
import evaluateChat from "./evaluate-chat";
import aosProtocol from "./aos-protocol";
import flagAgent from "./flag-agent";
import recruiterTools from "./recruiter-tools";
import sandboxManage from "./sandbox-manage";
import noted from "./noted";
import wiki from "./wiki";
import communityBoard from "./community-board";
import rsLabel from "./rs-label";
import assetMapper from "./asset-mapper";
import warehouse from "./warehouse";
import pMail from "./p-mail";
import vidiyo from "./vidiyo";
import yolodex from "./yolodex";
import codebauxProject from "./codebaux-project";
import formsBuilder from "./forms-builder";
import spreadsheetBuilder from "./spreadsheet-builder";
import reasoning from "./reasoning";

import type { Tool } from "./types";

export { SandboxManager } from "./sandbox";
export { ToolRouter } from "./router";
export type { ToolResult, ToolSchema, ToolHandler, ToolsConfig, Tool, ToolContext } from "./types";
export { formatResponse, formatError } from "./types";

// ── Flatten: some tools export a single Tool, others an array ──
function flatten(input: Tool | Tool[]): Tool[] {
  return Array.isArray(input) ? input : [input];
}

const ALL_TOOLS: Tool[] = [
  // Core
  ...flatten(codeEditor),
  ...flatten(fileCreate),
  ...flatten(httpRequest),
  ...flatten(bashCommand),
  ...flatten(jsExecute),
  ...flatten(pythonRunner),
  ...flatten(sqliteTool),
  ...flatten(readFile),
  ...flatten(projectScaffold),
  ...flatten(netTools),
  ...flatten(gitHost),
  ...flatten(calendar),
  // Extended
  ...flatten(analyzeResearch),
  ...flatten(browserRequest),
  ...flatten(composeEmail),
  ...flatten(createImage),
  ...flatten(tablemaker),
  ...flatten(tcpConnect),
  ...flatten(createMesh),
  ...flatten(contextResearchBrowser),
  ...flatten(frameworkExec),
  ...flatten(golangExec),
  ...flatten(editAudio),
  ...flatten(audioCleanup),
  ...flatten(createDrum),
  ...flatten(createObj),
  ...flatten(midiMp3),
  ...flatten(tts),
  ...flatten(stt),
  ...flatten(voiceClone),
  ...flatten(pdfExport),
  ...flatten(docxMd),
  ...flatten(mdDocx),
  ...flatten(personaCompose),
  ...flatten(readEmail),
  ...flatten(reviewResearch),
  ...flatten(tokenReplace),
  ...flatten(chatModeration),
  ...flatten(postImage),
  ...flatten(postVoiceNote),
  ...flatten(readChatLogs),
  ...flatten(evaluateChat),
  ...flatten(aosProtocol),
  ...flatten(flagAgent),
  ...flatten(recruiterTools),
  ...flatten(sandboxManage),
  ...flatten(noted),
  ...flatten(wiki),
  ...flatten(communityBoard),
  ...flatten(rsLabel),
  ...flatten(assetMapper),
  ...flatten(warehouse),
  ...flatten(pMail),
  ...flatten(vidiyo),
  ...flatten(yolodex),
  ...flatten(codebauxProject),
  ...flatten(formsBuilder),
  ...flatten(spreadsheetBuilder),
  ...flatten(reasoning),
];

export { ALL_TOOLS };

// ── Factory ─────────────────────────────────────────────────

export interface CreateToolRouterOptions {
  sandboxDir?: string;
  config?: Record<string, unknown>;
  enabledTools?: string[];
  disabledTools?: string[];
}

export function createToolRouter(options: CreateToolRouterOptions = {}): ToolRouter {
  const sandboxManager = new SandboxManager({
    baseDir: options.sandboxDir ?? "./sandbox",
  });

  const config = options.config ?? {};
  const router = new ToolRouter(sandboxManager, config);

  for (const tool of ALL_TOOLS) {
    if (options.enabledTools && !options.enabledTools.includes(tool.name)) continue;
    if (options.disabledTools?.includes(tool.name)) continue;
    router.addTool(tool);
  }

  return router;
}
