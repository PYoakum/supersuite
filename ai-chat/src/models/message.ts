export type SenderType = "human" | "agent" | "system";
export type ContentFormat = "text" | "structured" | "image" | "audio" | "aos" | "flag" | "tool-use" | "tool-done";

export interface ChatMessage {
  id: string;
  timestamp: string;
  senderType: SenderType;
  senderId: string;
  displayName: string;
  avatar?: string;
  role?: string;
  content: string;
  contentFormat: ContentFormat;
  tags?: string[];
  replyTo?: string;
  channel: string;
}

export interface CreateMessagePayload {
  senderType: SenderType;
  senderId: string;
  displayName: string;
  avatar?: string;
  role?: string;
  content: string;
  contentFormat?: ContentFormat;
  tags?: string[];
  replyTo?: string;
  channel?: string;
}

export interface SearchQuery {
  q?: string;
  senderId?: string;
  senderType?: SenderType;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export interface PaginationQuery {
  limit?: number;
  before?: string;  // cursor: message id
  after?: string;   // cursor: message id
  order?: "asc" | "desc";
}
