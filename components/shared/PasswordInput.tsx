'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/app/providers';

/**
 * Password field with a show/hide toggle. Every password field gets one:
 * typing blind, one wrong letter goes unnoticed until the login fails.
 */
export function PasswordInput({
  value, onChange, className = '', placeholder, autoComplete = 'new-password',
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? t('login.hidePassword') : t('login.showPassword')}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
