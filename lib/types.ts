export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'freelancer';
export type LeadStage =
  | 'new'
  | 'contacted'
  | 'discovery'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';
export type TaskStatus = 'todo' | 'in_progress' | 'internal_review' | 'client_approval' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type ClientStatus = 'onboarding' | 'active' | 'paused' | 'churned';
export type ContentStatus =
  | 'idea'
  | 'in_progress'
  | 'internal_review'
  | 'client_approval'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'archived';
export type ContentFormat = 'static' | 'carousel' | 'reel' | 'story' | 'video' | 'blog' | 'email' | 'ad' | 'other';
export type ApprovalDecision = 'pending' | 'approved' | 'changes_requested';

export interface Agency {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  job_title: string | null;
  skills: string[] | null;
}

export interface Membership {
  id: string;
  agency_id: string;
  user_id: string;
  role: MemberRole;
  active: boolean;
  hourly_cost: number | null;
  created_at: string;
  profile?: Profile | null;
}

export interface Client {
  id: string;
  agency_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  status: ClientStatus;
  account_manager_id: string | null;
  services: string[] | null;
  monthly_retainer: number | null;
  contract_start: string | null;
  contract_end: string | null;
  brand_colors: string | null;
  brand_voice: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  is_primary: boolean;
  /** Portal access is off until someone deliberately turns it on. */
  portal_enabled: boolean;
  /** Set on the contact's first magic-link sign-in. */
  user_id: string | null;
  last_portal_login: string | null;
}

export interface Lead {
  id: string;
  company: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  services_interested: string[] | null;
  estimated_value: number | null;
  stage: LeadStage;
  owner_id: string | null;
  next_follow_up: string | null;
  lost_reason: string | null;
  notes: string | null;
  converted_client_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  budget: number | null;
  owner_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  client_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  estimate_hours: number | null;
  position: number;
  revision_count: number;
  max_revisions: number | null;
  tags: string[] | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  task_id: string | null;
  project_id: string | null;
  client_id: string | null;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  note: string | null;
  billable: boolean;
}

export interface Channel {
  id: string;
  name: string;
  kind: 'general' | 'client' | 'project' | 'department';
  client_id: string | null;
  project_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface ContentItem {
  id: string;
  agency_id: string;
  client_id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  caption: string | null;
  hashtags: string[] | null;
  platforms: string[] | null;
  format: ContentFormat;
  status: ContentStatus;
  /** Plain YYYY-MM-DD, so the calendar grid needs no timezone maths. */
  scheduled_date: string | null;
  /** Plain HH:MM:SS. */
  scheduled_time: string | null;
  assignee_id: string | null;
  asset_urls: string[] | null;
  published_url: string | null;
  published_at: string | null;
  notes: string | null;
  revision_count: number;
  max_revisions: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentApproval {
  id: string;
  content_item_id: string;
  round: number;
  decision: ApprovalDecision;
  requested_by: string | null;
  requested_at: string;
  decided_by_contact_id: string | null;
  decided_by_profile_id: string | null;
  on_behalf: boolean;
  decided_at: string | null;
  comment: string | null;
}

export interface ContentComment {
  id: string;
  content_item_id: string;
  author_id: string | null;
  author_contact_id: string | null;
  body: string;
  visible_to_client: boolean;
  created_at: string;
}

export interface Credential {
  id: string;
  client_id: string;
  platform: string;
  label: string | null;
  username: string | null;
  url: string | null;
  notes: string | null;
  updated_at: string;
}

export interface ActivityItem {
  id: number;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}
