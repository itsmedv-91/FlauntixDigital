import type {
  ClientStatus,
  LeadStage,
  MemberRole,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from './types';

export const TASK_STATUSES: { value: TaskStatus; label: string; tone: string }[] = [
  { value: 'todo', label: 'To do', tone: 'bg-zinc-100 text-zinc-700' },
  { value: 'in_progress', label: 'In progress', tone: 'bg-sky-100 text-sky-800' },
  { value: 'internal_review', label: 'Internal review', tone: 'bg-amber-100 text-amber-800' },
  { value: 'client_approval', label: 'Client approval', tone: 'bg-brand-100 text-brand-800' },
  { value: 'done', label: 'Done', tone: 'bg-emerald-100 text-emerald-800' },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string; tone: string }[] = [
  { value: 'low', label: 'Low', tone: 'bg-zinc-100 text-zinc-600' },
  { value: 'medium', label: 'Medium', tone: 'bg-sky-50 text-sky-700' },
  { value: 'high', label: 'High', tone: 'bg-orange-100 text-orange-800' },
  { value: 'urgent', label: 'Urgent', tone: 'bg-red-100 text-red-700' },
];

export const LEAD_STAGES: { value: LeadStage; label: string }[] = [
  { value: 'new', label: 'New enquiry' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'discovery', label: 'Discovery call' },
  { value: 'proposal', label: 'Proposal sent' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; tone: string }[] = [
  { value: 'planning', label: 'Planning', tone: 'bg-zinc-100 text-zinc-700' },
  { value: 'active', label: 'Active', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'on_hold', label: 'On hold', tone: 'bg-amber-100 text-amber-800' },
  { value: 'completed', label: 'Completed', tone: 'bg-brand-100 text-brand-800' },
  { value: 'cancelled', label: 'Cancelled', tone: 'bg-red-100 text-red-700' },
];

export const CLIENT_STATUSES: { value: ClientStatus; label: string; tone: string }[] = [
  { value: 'onboarding', label: 'Onboarding', tone: 'bg-sky-100 text-sky-800' },
  { value: 'active', label: 'Active', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'paused', label: 'Paused', tone: 'bg-amber-100 text-amber-800' },
  { value: 'churned', label: 'Churned', tone: 'bg-zinc-200 text-zinc-600' },
];

export const ROLES: { value: MemberRole; label: string; description: string }[] = [
  { value: 'owner', label: 'Owner', description: 'Full access, billing and agency settings' },
  { value: 'admin', label: 'Admin', description: 'Full access to all data and team settings' },
  { value: 'manager', label: 'Manager', description: 'Clients, CRM, projects, vault and approvals' },
  { value: 'member', label: 'Team member', description: 'Tasks, projects, chat and time tracking' },
  { value: 'freelancer', label: 'Freelancer', description: 'Only tasks assigned to them' },
];

export const SERVICES = [
  'Social media management',
  'Performance marketing',
  'SEO',
  'Content writing',
  'Branding & design',
  'Video production',
  'Website development',
  'Influencer marketing',
  'Email marketing',
  'Strategy & consulting',
];

export const LEAD_SOURCES = ['Referral', 'Instagram', 'LinkedIn', 'Website', 'Cold outreach', 'Event', 'Other'];

export const VAULT_PLATFORMS = [
  'Instagram',
  'Facebook',
  'Meta Business Suite',
  'LinkedIn',
  'YouTube',
  'X (Twitter)',
  'Google Ads',
  'Google Analytics',
  'Search Console',
  'Website admin',
  'Hosting / cPanel',
  'Domain registrar',
  'Email',
  'Other',
];

export const MANAGER_ROLES: MemberRole[] = ['owner', 'admin', 'manager'];
export const ADMIN_ROLES: MemberRole[] = ['owner', 'admin'];
export const STAFF_ROLES: MemberRole[] = ['owner', 'admin', 'manager', 'member'];
