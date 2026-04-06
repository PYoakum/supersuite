import type { ChatMessage, CreateMessagePayload } from "../models/message";
import { generateId } from "../utils/ids";
import { storageService } from "./storage-service";
import { wsService } from "./websocket-service";
import { checkPersonaConsistency } from "./persona-service";
import { config } from "../config";

export interface CreateResult {
  message: ChatMessage;
  personaWarnings: string[];
}

class ChatService {
  createMessage(payload: CreateMessagePayload): CreateResult {
    const message: ChatMessage = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      senderType: payload.senderType,
      senderId: payload.senderId,
      displayName: payload.displayName,
      role: payload.role,
      content: payload.content,
      contentFormat: payload.contentFormat || "text",
      tags: payload.tags,
      replyTo: payload.replyTo,
      channel: payload.channel || config.defaultChannel,
    };

    const persona = checkPersonaConsistency(message.content, message.senderType);

    storageService.append(message);
    wsService.broadcastMessage(message);

    return { message, personaWarnings: persona.warnings };
  }

  clearHistory(): void {
    storageService.clear();
    wsService.broadcast("chat:cleared", {});
  }
}

export const chatService = new ChatService();
