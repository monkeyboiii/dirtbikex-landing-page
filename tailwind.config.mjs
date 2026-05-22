/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dirt: {
          50:  '#fff6ea',
          100: '#ffe6c2',
          200: '#fdc97a',
          300: '#fbab3c',
          400: '#f88e14',
          500: '#ed6b00',
          600: '#cf5300',
          700: '#a23d04',
          800: '#7e310c',
          900: '#5a240b',
          950: '#2e1004',
        },
        bone: {
          50:  '#faf8f4',
          100: '#f1ede4',
          200: '#e3dccd',
          300: '#cdc2ad',
          400: '#aea291',
          500: '#8e8273',
          600: '#6f655a',
          700: '#564f47',
          800: '#3d3833',
          900: '#25221f',
          950: '#16140f',
        },
        track: {
          300: '#b7b3ad',
          500: '#6e6c69',
          700: '#3c3b3a',
        },
        moto: {
          blue:   '#2a5cff',
          green:  '#2fa84f',
          red:    '#d23a2d',
          yellow: '#facc15',
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Noto Sans SC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans:    ['"Geist"', '"Noto Sans SC"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['"Geist Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      maxWidth: {
        narrow: '1040px',
        wide:   '1440px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
