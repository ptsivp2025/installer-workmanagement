export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours, matches TOKEN_HOURS in lib/db-token.ts

export const ROLES = ['admin', 'supervisor', 'installer', 'reviewer', 'sales'] as const;
export type Role = (typeof ROLES)[number];

export function roleLabel(role: string): string {
  switch (role) {
    case 'admin': return 'Admin';
    case 'supervisor': return 'Supervisor';
    case 'installer': return 'Installer';
    case 'reviewer': return 'Reviewer';
    case 'sales': return 'Sales Division';
    default: return role;
  }
}

export const ACTIVITY_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GPS_VALIDATION_STATUSES = ['valid', 'outside_radius', 'low_accuracy', 'unavailable', 'denied'] as const;
export type GpsValidationStatus = (typeof GPS_VALIDATION_STATUSES)[number];

export function statusLabel(status: string): string {
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function statusColor(status: string): string {
  switch (status) {
    case 'completed': case 'approved': case 'valid': case 'active': case 'submitted': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'in_progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'scheduled': case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'cancelled': case 'rejected': case 'outside_radius': case 'denied': return 'bg-red-50 text-red-700 border-red-200';
    case 'on_hold': return 'bg-slate-100 text-slate-700 border-slate-200';
    default: return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}
