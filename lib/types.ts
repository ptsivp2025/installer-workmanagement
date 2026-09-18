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
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sales_divisions?: Pick<SalesDivision, 'id' | 'name' | 'code'>;
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
  company_name: string;
  logo_url: string | null;
  timezone: string;
  date_format: string;
  show_dashboard_category_breakdown: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface ActivityDiscountEligibility {
  activity_id: string;
  project_id: string;
  demo_activity_id: string;
  demo_completed_at: string;
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
  pic_name: string | null;
  pic_phone: string | null;
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
  telegram_chat_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
