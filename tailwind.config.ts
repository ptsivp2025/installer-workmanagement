import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Each shade reads a CSS custom property (set at runtime by
        // lib/theme.ts from the admin's chosen primary color), falling back
        // to the original static hex when unset — so an un-customized
        // install looks pixel-identical to before, with zero flash.
        brand: {
          50: 'var(--brand-50, #eff6ff)',
          100: 'var(--brand-100, #dbeafe)',
          200: 'var(--brand-200, #bfdbfe)',
          300: 'var(--brand-300, #93c5fd)',
          400: 'var(--brand-400, #60a5fa)',
          500: 'var(--brand-500, #3b82f6)',
          600: 'var(--brand-600, #2563eb)',
          700: 'var(--brand-700, #1d4ed8)',
          800: 'var(--brand-800, #1e40af)',
          900: 'var(--brand-900, #1e3a8a)',
        },
      },
      // Same family as the Sales Management Platform: the sidebar appears
      // from 900px by width alone (a phone in Chrome's "desktop site" mode
      // reports ~980px and must still get the sidebar, not a shrunken tab bar).
      screens: {
        sidebar: { raw: '(min-width: 900px)' },
      },
      borderRadius: {
        chip: '0.5rem',
        card: '1rem',
        control: '0.75rem',
        panel: '1.5rem',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.06)',
        modal: '0 8px 40px rgba(0, 0, 0, 0.18)',
        dropdown: '0 8px 32px rgba(0, 0, 0, 0.18)',
        // Bento cards: low shadow so neighbouring cards don't look stacked.
        bento: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -12px rgba(15,23,42,0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
