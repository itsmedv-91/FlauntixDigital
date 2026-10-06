import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#15131F',
          soft: '#2A2738',
        },
        brand: {
          50: '#F3F0FF',
          100: '#E8E1FF',
          200: '#D2C4FF',
          300: '#B29BFF',
          400: '#8F6CFF',
          500: '#6D4AFF',
          600: '#5A35EB',
          700: '#4A28C7',
          800: '#3C22A0',
          900: '#2E1B7A',
        },
        coral: {
          400: '#FF7A66',
          500: '#F0533A',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(21,19,31,0.04), 0 1px 3px rgba(21,19,31,0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
