/**
 * Central place for API error logging. MVP: server logs only.
 * Future: best-effort insert into `api_errors` (or similar) without blocking the response.
 */
export interface ErrorAuditEvent {
  endpoint: string;
  method: string;
  requestId?: string;
  userId?: string;
  statusCode: number;
  errorCode: string;
  message: string;
  stack?: string;
  /** Non-sensitive diagnostic fields (e.g. path ids). */
  context?: Record<string, unknown>;
}

export const ErrorAuditService = {
  record(event: ErrorAuditEvent): void {
    // eslint-disable-next-line no-console -- single audit sink until DB table exists
    console.error("[APIErrorAudit]", event);
  },
};
