import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          light: '#F0D9B5',
          dark: '#B58863',
          selected: '#829769',
          legal: '#646E40',
          check: '#FF6B6B',
          'last-move': '#CDA85F',
        },
      },
    },
  },
  plugins: [],
};

export default config;
