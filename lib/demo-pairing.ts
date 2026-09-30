import type { DemoTimelineRow } from './types';

/**
 * Which purchases still need their demo pinned down, and which demos they
 * could be paired with. Used by the recap page and the dashboard card, so the
 * two can never disagree about the count.
 *
 * Deliberately doesn't wait for a good automatic guess: activities created
 * before rooms and products were recorded have neither, so nothing can be
 * suggested for them — yet a purchase in a project that has an unused demo is
 * exactly the case somebody has to pair by hand.
 */
export interface NeedsPairing {
  purchase: DemoTimelineRow;
  /** Demos in the same project that don't back another purchase yet. */
  candidates: DemoTimelineRow[];
}

export interface Pairing {
  /** Purchases whose demo is confirmed. */
  linked: DemoTimelineRow[];
  /** Purchases in a project with an unused demo, still unpaired. */
  needsPairing: NeedsPairing[];
}

export function computePairing(rows: DemoTimelineRow[]): Pairing {
  // A demo already backing a purchase is spent (one demo, one purchase).
  const spent = new Set<string>();
  for (const r of rows) if (r.counts_as_installation && r.demo_activity_id) spent.add(r.demo_activity_id);

  const freeDemos = new Map<string, DemoTimelineRow[]>();
  for (const r of rows) {
    if (!r.counts_as_demo || r.status === 'cancelled' || spent.has(r.activity_id)) continue;
    const list = freeDemos.get(r.project_id) ?? [];
    list.push(r);
    freeDemos.set(r.project_id, list);
  }

  const linked: DemoTimelineRow[] = [];
  const needsPairing: NeedsPairing[] = [];
  for (const r of rows) {
    if (!r.counts_as_installation) continue;
    if (r.demo_activity_id) { linked.push(r); continue; }
    if (r.status === 'cancelled') continue;
    const candidates = freeDemos.get(r.project_id) ?? [];
    // A purchase in a project that never had a demo owes nobody a discount:
    // it isn't "waiting" for anything, so it stays out of the list.
    if (candidates.length > 0) needsPairing.push({ purchase: r, candidates });
  }
  return { linked, needsPairing };
}
