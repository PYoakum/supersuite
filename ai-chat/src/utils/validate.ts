import type { CreateMessagePayload, SenderType } from "../models/message";
import { config } from "../config";

const VALID_SENDER_TYPES: SenderType[] = ["human", "agent", "system"];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateCreateMessage(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Request body must be a JSON object"] };
  }

  const p = payload as Record<string, unknown>;

  if (!p.senderType || !VALID_SENDER_TYPES.includes(p.senderType as SenderType)) {
    errors.push(`senderType must be one of: ${VALID_SENDER_TYPES.join(", ")}`);
  }
  if (!p.senderId || typeof p.senderId !== "string" || p.senderId.trim().length === 0) {
    errors.push("senderId is required and must be a non-empty string");
  }
  if (!p.displayName || typeof p.displayName !== "string" || p.displayName.trim().length === 0) {
    errors.push("displayName is required and must be a non-empty string");
  }
  if (!p.content || typeof p.content !== "string" || p.content.trim().length === 0) {
    errors.push("content is required and must be a non-empty string");
  }
  if (typeof p.content === "string" && p.content.length > config.maxMessageLength) {
    errors.push(`content must be at most ${config.maxMessageLength} characters`);
  }
  if (p.contentFormat && !["text", "structured", "image", "audio", "aos", "flag", "tool-use", "tool-done"].includes(p.contentFormat as string)) {
    errors.push("contentFormat must be 'text', 'structured', 'image', 'audio', 'aos', 'flag', 'tool-use', or 'tool-done'");
  }
  if (p.avatar && typeof p.avatar !== "string") {
    errors.push("avatar must be a string URL if provided");
  }
  if (p.tags && !Array.isArray(p.tags)) {
    errors.push("tags must be an array if provided");
  }

  return { valid: errors.length === 0, errors };
}
