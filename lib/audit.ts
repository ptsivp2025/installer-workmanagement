import { getAdminClient } from './supabase-admin';

export type AuditAction =
  | 'project.created' | 'project.updated'
  | 'activity.created' | 'activity.updated' | 'activity.status_changed'
  | 'activity.personnel_changed' | 'activity.gps_captured' | 'activity.completed'
  | 'evidence.uploaded' | 'evidence.deleted'
  | 'review.approved' | 'review.rejected'
  | 'category.created' | 'category.updated';

/**
 * Best-effort audit log write. Never throws — a failed audit insert must
 * not roll back or block the business mutation it's describing.
 */
export async function logAudit(params: {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getAdminClient();
    await supabase.from('audit_logs').insert({
      actor_id: params.actorId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      meta: params.meta ?? {},
    });
  } catch {
    /* audit logging is best-effort */
  }
}
