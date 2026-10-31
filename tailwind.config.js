/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        ink: '#06080b',
        panel: '#0b1016',
        neon: '#3dff7a',
        neonDim: '#1f8f47',
        cyan: '#27e1ff',
        magenta: '#ff3df0',
        amber: '#ffd23d',
        danger: '#ff4d5e',
        muted: '#85949f',
      },
      fontFamily: {
        sans: ['Rajdhani', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 12px rgba(61, 255, 122, 0.45), 0 0 2px rgba(61, 255, 122, 0.8)',
        cyan: '0 0 14px rgba(39, 225, 255, 0.45)',
      },
    },
  },
  plugins: [],
};
