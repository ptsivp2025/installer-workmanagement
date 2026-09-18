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
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  activity_categories?: Pick<ActivityCategory, 'id' | 'name' | 'code' | 'requires_gps' | 'requires_evidence' | 'requires_personnel' | 'evidence_min_count' | 'gps_radius_m'>;
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
  full_name: string;
  role: string;
  active: boolean;
}
