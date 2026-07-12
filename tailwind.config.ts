import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        panel: 'var(--color-panel)',
        'panel-2': 'var(--color-panel-2)',
        border: 'var(--color-border)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        success: 'var(--color-success)',
        'success-hover': 'var(--color-success-hover)',
        hover: 'var(--color-hover)',
        active: 'var(--color-active)',
        overlay: 'var(--color-overlay)'
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        floating: 'var(--sidebar-radius)'
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        floating: 'var(--sidebar-shadow)'
      },
      spacing: {
        'floating-inset': 'var(--sidebar-inset)'
      },
      fontFamily: {
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config
