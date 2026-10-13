/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#1D2733", soft: "#4A5663", faint: "#7A8693" },
        paper: "#EEF1F3",
        rule: "#D3D9DF",
        route: { DEFAULT: "#0B6E69", dark: "#085550", tint: "#E3F1EF" },
        signal: { DEFAULT: "#C27D00", tint: "#FBF0D9" },
        stop: { DEFAULT: "#B8382B", tint: "#F8E3E0" },
        go: { DEFAULT: "#2F7D4F", tint: "#E2F0E7" },
        rail: { DEFAULT: "#22303D", hover: "#2C3D4D" },
      },
      fontFamily: {
        sign: ['"Overpass"', '"Segoe UI"', "system-ui", "sans-serif"],
        sans: ['"Public Sans"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};
