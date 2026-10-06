import Link from 'next/link';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import type { Profile, TaskPriority, TaskStatus } from '@/lib/types';
import { cn, formatDate, isOverdue } from '@/lib/utils';
import { Avatar, Badge } from './ui';

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUSES.find((x) => x.value === status);
  return <Badge className={s?.tone}>{s?.label ?? status}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const p = TASK_PRIORITIES.find((x) => x.value === priority);
  return <Badge className={p?.tone}>{p?.label ?? priority}</Badge>;
}

export function DueDate({ date, status }: { date: string | null; status?: TaskStatus }) {
  if (!date) return <span className="text-xs text-zinc-400">No due date</span>;
  const overdue = isOverdue(date, status);
  return <span className={cn('text-xs', overdue ? 'font-semibold text-coral-500' : 'text-zinc-500')}>{overdue ? 'Overdue · ' : ''}{formatDate(date)}</span>;
}

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee?: Profile | null;
  project?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
}

export function TaskRow({ task, showAssignee = true }: { task: TaskListItem; showAssignee?: boolean }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[task.client?.name, task.project?.name].filter(Boolean).join(' · ') || 'No project'}
        </p>
      </div>
      <div className="hidden items-center gap-1.5 sm:flex">
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>
      <div className="w-24 text-right">
        <DueDate date={task.due_date} status={task.status} />
      </div>
      {showAssignee && (task.assignee ? <Avatar person={task.assignee} size="sm" /> : <span className="h-6 w-6 rounded-full border border-dashed border-zinc-300" title="Unassigned" />)}
    </Link>
  );
}

export const TASK_SELECT =
  'id, title, status, priority, due_date, position, assignee_id, revision_count, assignee:profiles!tasks_assignee_id_fkey(id, full_name, email), project:projects(id, name), client:clients(id, name)';
