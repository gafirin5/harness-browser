/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1D4ED8',
          dark: '#1E40AF',
          soft: '#DBEAFE'
        },
        success: {
          DEFAULT: '#166534',
          soft: '#DCFCE7'
        },
        warning: {
          DEFAULT: '#A16207',
          soft: '#FEF9C3'
        },
        danger: {
          DEFAULT: '#B91C1C',
          soft: '#FEE2E2'
        },
        ink: '#0F172A',
        muted: '#475569',
        canvas: '#F1F5F9',
        line: '#CBD5E1',
        console: '#0F172A'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', '"Courier New"', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.1)'
      }
    }
  },
  plugins: []
};
