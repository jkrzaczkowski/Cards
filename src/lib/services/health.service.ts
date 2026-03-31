import type { HealthDto } from "@/types";

/**
 * Liveness payload for `GET /api/v1/health` — no DB or external calls.
 */
export function getHealth(): HealthDto {
  return { status: "ok" };
}
