/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        databricks: {
          orange: "#FF3621",
          navy: "#1B3139",
          slate: "#445969",
          mint: "#00A972",
          sand: "#F9F7F4",
        },
        veeva: {
          blue: "#0066B2",
          ink: "#1A2B3C",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        ipad: "0 30px 60px -15px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
};
