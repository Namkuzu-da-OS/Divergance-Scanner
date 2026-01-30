import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f0f',
          secondary: '#1a1a1a',
          tertiary: '#252525',
        },
        border: {
          DEFAULT: '#333333',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
