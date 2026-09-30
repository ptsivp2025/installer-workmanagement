'use client';

import { useSettings } from '@/app/providers';
import type { PositionOption } from './settings';

/** Job titles from Admin Panel → Aturan Sistem → Data Master. */
export function usePositions(): PositionOption[] {
  return useSettings().get<PositionOption[]>('master.positions');
}

/** The label of a stored job title; an old value no longer in the list still shows as itself. */
export function positionLabel(value: string | null | undefined, list: PositionOption[]): string {
  if (!value) return '';
  return list.find(p => p.value === value)?.label ?? value.replace(/_/g, ' ');
}
