import { log } from "../logger";

export interface ChatMessage {
  id: string;
  timestamp: string;
  senderType: string;
  senderId: string;
  displayName: string;
  role?: string;
  content: string;
  contentFormat: string;
  tags?: string[];
  channel: string;
}

export async function fetchHistory(apiUrl: string, limit: number): Promise<ChatMessage[]> {
  try {
    const res = await fetch(`${apiUrl}/api/messages?limit=${limit}&order=asc`);
    if (!res.ok) {
      log.warn(`Failed to fetch history: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.messages || [];
  } catch (err) {
    log.warn(`History fetch error: ${err}`);
    return [];
  }
}
