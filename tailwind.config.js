/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ocean: '#2978a0',
        ink: '#181d27',
        sage: '#7fbeab',
        blush: '#e3d0d8',
        lavender: '#aea3b0',
      },
      fontFamily: {
        serif: ['"PT Serif"', 'Georgia', 'serif'],
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
