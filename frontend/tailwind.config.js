/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pulse: {
          bg: "#0b1020",
          panel: "#121935",
          accent: "#38bdf8",
          accent2: "#a78bfa",
        },
      },
    },
  },
  plugins: [],
};
