import { getLastResult } from "./roles";

// Available tools in the chat-agent tool library (auto-discovered names)
export const AVAILABLE_TOOLS = [
  // Core
  "code_editor",
  "file_create",
  "http_request",
  "bash_command",
  "javascript_execute",
  "python_runner",
  "sqlite_query",
  "read_file",
  "project_scaffold",
  "net_tools",
  "git_host",
  "calendar",
  // Research & browser
  "analyze_research",
  "browser_request",
  "context_research_browser",
  "review_research",
  // Communication
  "compose_email",
  "read_email",
  "read_email_list",
  "read_email_remove",
  "persona_compose",
  // Media & audio
  "create_image",
  "midi_mp3",
  "make_music",
  "tts",
  "text_to_speech",
  "speak",
  "speech_to_text",
  "stt",
  "transcribe_audio",
  "record_and_transcribe",
  "voice_clone",
  "clone_voice",
  "convert_voice",
  "edit_audio",
  "audio_edit",
  "audio_cleanup",
  "clean_audio",
  "trim_silence",
  "create_drum",
  "drum_machine",
  "make_beat",
  // 3D & export
  "create_mesh",
  "create_obj",
  "pdf_export",
  "docx_md",
  "md_docx",
  // Dev & infra
  "tablemaker",
  "tcp_connect",
  "framework_exec",
  "golang_exec",
  "token_replace",
  // Chat interaction
  "post_image",
  "post_voice_note",
  "read_chat_logs",
  "evaluate_chat",
  // AOS protocol
  "aos_send",
  "aos_decode",
  "aos_handshake",
  // Sandbox management
  "sandbox_search_files",
  "sandbox_search_content",
  "sandbox_move",
  "sandbox_rename",
  "sandbox_list",
  // Homelab integrations
  "noted",
  "wiki",
  "community_board",
  "rs_label",
  "asset_mapper",
  "warehouse",
  "codebaux_project",
  "forms_builder",
  "spreadsheet_builder",
  "p_mail",
  "vidiyo",
  "yolodex",
  // Recruiter
  "recruit_agent",
  "dismiss_agent",
  "team_status",
  "update_task_tokens",
  // Reasoning
  "thinking",
  "analyzing",
  "reviewing_work",
  // Moderation (PM-only by default)
  "flag_agent",
  "chat_participation",
  "mute_agent",
  "unmute_agent",
] as const;

/** Tool categories for UI grouping */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  "Core": ["code_editor", "file_create", "http_request", "bash_command", "javascript_execute", "python_runner", "sqlite_query", "read_file", "project_scaffold", "net_tools"],
  "Research": ["analyze_research", "browser_request", "context_research_browser", "review_research"],
  "Communication": ["compose_email", "read_email", "read_email_list", "read_email_remove", "persona_compose"],
  "Media & Audio": ["create_image", "midi_mp3", "make_music", "tts", "text_to_speech", "speak", "speech_to_text", "stt", "transcribe_audio", "record_and_transcribe", "voice_clone", "clone_voice", "convert_voice", "edit_audio", "audio_edit", "audio_cleanup", "clean_audio", "trim_silence", "create_drum", "drum_machine", "make_beat"],
  "3D & Export": ["create_mesh", "create_obj", "pdf_export", "docx_md", "md_docx"],
  "Dev & Infra": ["tablemaker", "tcp_connect", "framework_exec", "golang_exec", "token_replace"],
  "Chat": ["post_image", "post_voice_note", "read_chat_logs", "evaluate_chat"],
  "AOS Protocol": ["aos_send", "aos_decode", "aos_handshake"],
  "Sandbox": ["sandbox_search_files", "sandbox_search_content", "sandbox_move", "sandbox_rename", "sandbox_list"],
  "Homelab Apps": ["calendar", "git_host", "noted", "wiki", "community_board", "rs_label", "asset_mapper", "warehouse", "p_mail", "vidiyo", "yolodex"],
  "File Builders": ["codebaux_project", "forms_builder", "spreadsheet_builder"],
  "Reasoning": ["thinking", "analyzing", "reviewing_work"],
  "Recruiter": ["recruit_agent", "dismiss_agent", "team_status", "update_task_tokens"],
  "Moderation": ["flag_agent", "chat_participation", "mute_agent", "unmute_agent"],
};

/** In-memory tool assignments: roleId -> tool names */
const toolAssignments = new Map<string, string[]>();

/** Default tools by role kind */
const DEFAULTS: Record<string, string[]> = {
  pm: ["http_request", "read_file", "calendar", "read_chat_logs", "evaluate_chat", "post_image", "post_voice_note", "tts", "speak", "aos_send", "aos_decode", "aos_handshake", "flag_agent", "chat_participation", "mute_agent", "unmute_agent", "sandbox_search_files", "sandbox_search_content", "sandbox_list", "sandbox_move", "sandbox_rename", "noted", "wiki", "community_board", "thinking", "analyzing", "reviewing_work"],
  worker: ["code_editor", "file_create", "read_file", "bash_command", "javascript_execute", "http_request", "read_chat_logs", "post_image", "post_voice_note", "tts", "speak", "aos_send", "aos_decode", "aos_handshake", "sandbox_search_files", "sandbox_search_content", "sandbox_list", "noted", "wiki", "thinking", "analyzing", "reviewing_work"],
  recruiter: ["recruit_agent", "dismiss_agent", "team_status", "update_task_tokens", "read_chat_logs", "evaluate_chat", "flag_agent", "aos_send", "aos_decode", "sandbox_search_files", "sandbox_search_content", "sandbox_list", "sandbox_move", "sandbox_rename", "noted", "thinking", "analyzing", "reviewing_work"],
};

export function getToolsForRole(roleId: string): string[] {
  return toolAssignments.get(roleId) || [];
}

export function getDefaultToolsForKind(kind: string): string[] {
  return DEFAULTS[kind] || [];
}

export function handleListTools(): Response {
  return Response.json({ ok: true, tools: AVAILABLE_TOOLS, categories: TOOL_CATEGORIES });
}

export async function handleAssignTools(req: Request): Promise<Response> {
  let body: { roleId: string; tools: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.roleId || !Array.isArray(body.tools)) {
    return Response.json(
      { ok: false, errors: ["roleId (string) and tools (string[]) are required"] },
      { status: 400 },
    );
  }

  // Validate tool names
  const invalid = body.tools.filter(t => !AVAILABLE_TOOLS.includes(t as any));
  if (invalid.length > 0) {
    return Response.json(
      { ok: false, errors: [`Unknown tools: ${invalid.join(", ")}. Available: ${AVAILABLE_TOOLS.join(", ")}`] },
      { status: 400 },
    );
  }

  toolAssignments.set(body.roleId, [...body.tools]);

  // Also update the in-memory lastResult
  const lastResult = getLastResult();
  if (lastResult) {
    const assignment = lastResult.assignments.find(a => a.roleId === body.roleId);
    if (assignment) assignment.tools = [...body.tools];
    const prompt = lastResult.prompts.find(p => p.roleId === body.roleId);
    if (prompt) prompt.tools = [...body.tools];
  }

  return Response.json({ ok: true, roleId: body.roleId, tools: body.tools });
}

export function handleGetToolAssignments(): Response {
  const assignments: Record<string, string[]> = {};
  for (const [roleId, tools] of toolAssignments) {
    assignments[roleId] = tools;
  }
  return Response.json({ ok: true, assignments });
}
