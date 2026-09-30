// How long a tab trusts its cached profile (lib/auth.ts) before re-checking
// the login with the server. Not the login's lifetime: that's the session
// cookie (lib/server-auth.ts). Matches TOKEN_HOURS in lib/db-token.ts.
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

// GPS flags that only say HOW a job was done, not that anything looks faked:
// 'web_browser' (outside the Android app; it blocks only when the app is
// required) and 'no_challenge' (a page loaded before migration 026).
const INFO_GPS_FLAGS = ['web_browser', 'no_challenge'];

/** The GPS risk flags worth showing a reviewer. */
export function suspiciousGpsFlags(flags: string[] | null | undefined): string[] {
  return (flags ?? []).filter(f => !INFO_GPS_FLAGS.includes(f));
}

export const ROLES = ['admin', 'supervisor', 'installer', 'reviewer', 'sales_admin', 'sales'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The four kinds of account people choose between (register, Admin Panel):
 *  - admin:       Admin Aplikasi, runs the platform.
 *  - team:        internal staff; the role below it says which (installer,
 *                 supervisor, reviewer).
 *  - sales_admin: a vendor's Admin Sales; sees and requests for the whole
 *                 division, on behalf of its Sales Proyek.
 *  - sales:       Sales Proyek, the Sales a project belongs to.
 * Admin Sales and Sales Proyek of one division are one team: both see every
 * project of that division (migration 030).
 */
export const ACCOUNT_TYPES = ['team', 'admin', 'sales_admin', 'sales'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const TEAM_ROLES = ['installer', 'supervisor', 'reviewer'] as const;
/** What someone may pick on the public sign-up page (never admin). */
export const SELF_REGISTER_ROLES = [...TEAM_ROLES, 'sales_admin', 'sales'] as const;

export function accountTypeOf(role: string | null | undefined): AccountType {
  return role === 'admin' ? 'admin' : role === 'sales_admin' ? 'sales_admin' : role === 'sales' ? 'sales' : 'team';
}
/** Vendor-side accounts: they belong to a division and see only its work. */
export function isSalesRole(role: string | null | undefined): boolean {
  return role === 'sales' || role === 'sales_admin';
}

// Job title, tracked separately from `role`: role decides what the platform
// lets you do, position is who you are in the org chart (a Manager and a
// Staff can both be 'installer').
export const POSITIONS = ['staff', 'senior_staff', 'supervisor', 'manager', 'director'] as const;
export type Position = (typeof POSITIONS)[number];

export const ACTIVITY_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ProjectRequestStatus = (typeof PROJECT_REQUEST_STATUSES)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

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
