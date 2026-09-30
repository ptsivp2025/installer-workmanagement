export interface Project {
  id: string;
  code: string;
  name: string;
  customer_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notes: string | null;
  expected_completion: string | null;
  sales_division_id: string | null;
  sales_person_name: string | null;
  /** The sales account this project belongs to (029). NULL = not assigned yet. */
  sales_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sales_divisions?: Pick<SalesDivision, 'id' | 'name' | 'code'>;
  sales_user?: { id: string; full_name: string; username: string } | null;
}

/** A confirmed Demo → Purchase link and how the claim against the installer is going (029). */
export interface DemoLink {
  purchase_activity_id: string;
  demo_activity_id: string;
  match_reason: 'room_and_product' | 'room' | 'product' | 'manual';
  billing_status: 'not_billed' | 'billed' | 'accepted' | 'rejected';
  billing_note: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
}

/** One row of the Demo → Bongkar → Beli timeline (view activity_demo_timeline, 029). */
export interface DemoTimelineRow {
  activity_id: string;
  project_id: string;
  request_number: string;
  title: string;
  room_name: string | null;
  status: string;
  scheduled_date: string;
  completed_at: string | null;
  product_brand: string | null;
  product_type: string | null;
  product_model: string | null;
  category_name: string;
  counts_as_demo: boolean;
  counts_as_installation: boolean;
  demo_activity_id: string | null;
  match_reason: DemoLink['match_reason'] | null;
  billing_status: DemoLink['billing_status'] | null;
  billing_note: string | null;
  demo_completed_at: string | null;
  demo_request_number: string | null;
  demo_room_name: string | null;
  demo_product_brand: string | null;
  demo_product_type: string | null;
  demo_product_model: string | null;
  days_since_demo: number | null;
}

/** A candidate demo for a purchase that has no confirmed link yet (view activity_demo_suggestions, 029). */
export interface DemoSuggestion {
  purchase_activity_id: string;
  project_id: string;
  demo_activity_id: string;
  demo_request_number: string;
  demo_title: string;
  demo_room_name: string | null;
  demo_completed_at: string | null;
  demo_product_brand: string | null;
  demo_product_type: string | null;
  demo_product_model: string | null;
  match_reason: DemoLink['match_reason'];
  days_since_demo: number | null;
  rank: number;
}

export interface ActivityCategory {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  active: boolean;
  requires_gps: boolean;
  requires_evidence: boolean;
  requires_personnel: boolean;
  evidence_min_count: number;
  gps_radius_m: number;
  gps_accuracy_threshold_m: number;
  counts_as_demo: boolean;
  counts_as_installation: boolean;
  created_at: string;
  updated_at: string;
}

export interface SalesDivision {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectRequest {
  id: string;
  requested_by: string;
  sales_division_id: string;
  project_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category_id: string | null;
  requested_date: string | null;
  notes: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  resulting_project_id: string | null;
  created_at: string;
  /** The Sales Proyek the request is for (030); the project will be theirs. */
  sales_user_id: string | null;
  users?: { full_name: string | null; username: string } | null;
  owner?: { full_name: string | null; username: string } | null;
  sales_divisions?: { name: string } | null;
  activity_categories?: { name: string } | null;
}

export interface NotificationSettings {
  id: boolean;
  telegram_bot_token: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface NotificationGroup {
  id: string;
  name: string;
  telegram_chat_id: string;
  notify_on_completion: boolean;
  notify_on_review_decision: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformSettings {
  id: boolean;
  platform_name: string;
  company_name: string;
  logo_url: string | null;
  timezone: string;
  date_format: string;
  show_dashboard_category_breakdown: boolean;
  /** Migration 024: GPS-verified jobs must be completed in the Android app. */
  require_native_app?: boolean;
  primary_color: string;
  secondary_color: string;
  login_bg_url: string | null;
  login_headline: string | null;
  login_subheadline: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface ActivityDiscountEligibility {
  activity_id: string;
  project_id: string;
  demo_activity_id: string;
  demo_completed_at: string;
  demo_product_brand: string | null;
  demo_product_type: string | null;
  demo_product_model: string | null;
  days_since_demo: number;
}

export interface Activity {
  id: string;
  request_number: string;
  project_id: string;
  category_id: string;
  title: string;
  customer_name: string | null;
  location_address: string | null;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  priority: string;
  status: string;
  personnel_count: number;
  notes: string | null;
  target_latitude: number | null;
  target_longitude: number | null;
  execution_latitude: number | null;
  execution_longitude: number | null;
  gps_accuracy_m: number | null;
  gps_captured_at: string | null;
  distance_from_target_m: number | null;
  gps_validation_status: string | null;
  /** Fake-GPS signals found at completion (migration 023); empty = clean. */
  gps_risk_flags?: string[] | null;
  /** GPS check-in at start (migration 025). */
  started_at?: string | null;
  start_distance_m?: number | null;
  start_gps_flags?: string[] | null;
  pic_name: string | null;
  pic_phone: string | null;
  product_brand: string | null;
  product_type: string | null;
  product_model: string | null;
  /** Room / installation spot (029) — what links a demo to its later purchase
   *  even when the product itself was swapped. */
  room_name?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  activity_categories?: Pick<ActivityCategory, 'id' | 'name' | 'code' | 'requires_gps' | 'requires_evidence' | 'requires_personnel' | 'evidence_min_count' | 'gps_radius_m' | 'counts_as_demo' | 'counts_as_installation'>;
  projects?: Pick<Project, 'id' | 'name' | 'code'>;
}

export interface ActivityPersonnel {
  id: string;
  activity_id: string;
  user_id: string | null;
  name: string;
  role: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface ActivityEvidence {
  id: string;
  activity_id: string;
  project_id: string;
  uploader_id: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  evidence_type: string;
  latitude: number | null;
  longitude: number | null;
  uploaded_at: string;
}

export interface FormReview {
  id: string;
  activity_id: string;
  status: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  activities?: Activity;
}

export interface AppUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  telegram_chat_id: string | null;
  sales_division_id: string | null;
  active: boolean;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
  sales_divisions?: Pick<SalesDivision, 'id' | 'name' | 'code'>;
}

export interface SalesReview {
  id: string;
  activity_id: string;
  status: string;
  rating: number | null;
  comment: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  activities?: Activity;
}
