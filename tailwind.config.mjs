/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dirt: {
          50: '#fff8eb',
          100: '#feeac7',
          200: '#fcd28a',
          300: '#fbb44d',
          400: '#fa9824',
          500: '#f3760b',
          600: '#d75606',
          700: '#b23a09',
          800: '#902d0e',
          900: '#76270f',
          950: '#441103',
        },
        clay: {
          50: '#f7f6f4',
          100: '#e9e6e1',
          200: '#d3cdc3',
          300: '#b6ac9d',
          400: '#998c79',
          500: '#847665',
          600: '#6d6052',
          700: '#594e44',
          800: '#4a423b',
          900: '#3f3934',
          950: '#231f1c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
