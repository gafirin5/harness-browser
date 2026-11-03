import { formatUsd4, type TaskPriority } from '@orca/shared';

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value);
}

export function formatUsd(value: string): string {
  return formatUsd4(value);
}

export function priorityLabel(priority: TaskPriority): string {
  return priority === 3 ? 'Tinggi' : priority === 2 ? 'Normal' : 'Rendah';
}
