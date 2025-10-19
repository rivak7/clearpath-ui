/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  safelist: ['animate-breathe', 'animate-pulseRing', 'animate-pulse'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        mint: {
          500: '#26D0A4'
        },
        teal: {
          500: '#1AA5A0'
        },
        amber: {
          500: '#E8A74B'
        },
        coral: {
          500: '#E85D5A'
        },
        night: '#09172C',
        day: '#F7FBFF',
        textDark: '#EAF2F8',
        textLight: '#0F1A2A'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'Apple Color Emoji', 'Segoe UI Emoji']
      },
      boxShadow: {
        shell: '0 12px 32px rgba(0,0,0,0.25)',
        glass: '0 8px 24px rgba(9, 23, 44, 0.35)'
      },
      backdropBlur: {
        xs: '8px'
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.75' },
          '50%': { transform: 'scale(1.12)', opacity: '1' }
        },
        pulseRing: {
          '0%': { transform: 'scale(0.8)', opacity: '0.6' },
          '100%': { transform: 'scale(1.3)', opacity: '0' }
        }
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        pulseRing: 'pulseRing 1.2s ease-out infinite'
      }
    }
  },
  plugins: []
};
