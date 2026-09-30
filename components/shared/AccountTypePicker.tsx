'use client';

import { Users, ShieldCheck, Briefcase, UserRound } from 'lucide-react';
import { useLanguage } from '@/app/providers';
import { SearchableSelect } from './SearchableSelect';
import { TEAM_ROLES, accountTypeOf, isSalesRole, type AccountType } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';

const ICON: Record<AccountType, React.ElementType> = { team: Users, admin: ShieldCheck, sales_admin: Briefcase, sales: UserRound };
/** The role a type starts as when picked. */
const FIRST_ROLE: Record<AccountType, string> = { team: 'installer', admin: 'admin', sales_admin: 'sales_admin', sales: 'sales' };

/**
 * One picker for "what kind of account is this", shared by the sign-up page
 * and Admin Panel → Users so both say the same thing: Team (internal staff,
 * then which role), Admin, Admin Sales, or Sales Proyek. The two vendor-side
 * types need a division — the one team they belong to.
 */
export function AccountTypePicker({
  role, divisionId, onChange, types, divisions, disabled,
}: {
  role: string;
  divisionId: string;
  onChange: (next: { role: string; divisionId: string }) => void;
  types: readonly AccountType[];
  divisions: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const current = accountTypeOf(role);

  return (
    <div className="space-y-3">
      <div>
        <p className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">{t('account.title')}</p>
        <div className={`grid gap-2 ${types.length > 3 ? 'grid-cols-2' : types.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
          {types.map(type => {
            const Icon = ICON[type];
            const on = current === type;
            return (
              <button key={type} type="button" disabled={disabled}
                onClick={() => onChange({ role: on ? role : FIRST_ROLE[type], divisionId: isSalesRole(FIRST_ROLE[type]) ? divisionId : '' })}
                aria-pressed={on}
                className={`text-left rounded-control border px-3 py-2.5 transition disabled:opacity-60 ${
                  on ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <span className={`flex items-center gap-1.5 text-[13px] font-bold ${on ? 'text-brand-800' : 'text-slate-800'}`}>
                  <Icon className="h-4 w-4 shrink-0" />{t(`account.${type}` as DictKey)}
                </span>
                <span className="block text-[11px] leading-snug text-slate-500 mt-0.5">{t(`account.${type}.desc` as DictKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {current === 'team' && (
        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">{t('account.teamRole')}</label>
          <select value={role} disabled={disabled} onChange={e => onChange({ role: e.target.value, divisionId: '' })}
            className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {TEAM_ROLES.map(r => <option key={r} value={r}>{t(`role.${r}` as DictKey)}</option>)}
          </select>
        </div>
      )}

      {isSalesRole(role) && (
        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">
            {t('register.salesDivision')}<span className="text-red-500"> *</span>
          </label>
          <SearchableSelect
            value={divisionId}
            onChange={v => onChange({ role, divisionId: v })}
            options={divisions.map(d => ({ value: d.id, label: d.name }))}
            placeholder={t('register.selectDivision')}
          />
          <p className="text-[11px] text-slate-400 mt-1">{t('account.divisionHint')}</p>
        </div>
      )}
    </div>
  );
}
