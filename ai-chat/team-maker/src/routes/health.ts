import { config } from "../config";

export function handleHealth(): Response {
  return Response.json({
    ok: true,
    service: "team-maker",
    provider: config.defaultProvider,
    model: config.defaultModel,
  });
}
