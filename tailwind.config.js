/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b0a",
        panel: "#151513",
        panel2: "#1d1d1a",
        ink: "#f2efe9",
        cream: "#dcd7ce",
        muted: "#8b877f",
        red: "#e6331c",
        red2: "#ff4a2e",
        gold: "#ffc247",
        mint: "#4ade80",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Noto Sans Ethiopic", "sans-serif"],
        display: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Noto Sans Ethiopic", "sans-serif"],
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(.4)", opacity: "0" },
          "60%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        bob: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        jump: {
          "0%": { transform: "translateY(0) scale(1)" },
          "30%": { transform: "translateY(-18px) scale(1.04)" },
          "60%": { transform: "translateY(0) scale(1)" },
          "100%": { transform: "translateY(0) scale(1)" },
        },
        sway: {
          "0%, 100%": { transform: "rotate(-1.2deg)" },
          "50%": { transform: "rotate(1.2deg)" },
        },
        beam: {
          "0%, 100%": { opacity: "0.75", filter: "blur(0px)" },
          "50%": { opacity: "1", filter: "blur(1px)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.15" },
          "50%": { transform: "translateY(-16px)", opacity: "0.5" },
        },
        flicker: {
          "0%, 100%": { opacity: "0.85" },
          "47%": { opacity: "0.85" },
          "48%": { opacity: "0.35" },
          "49%": { opacity: "0.85" },
          "72%": { opacity: "0.55" },
          "73%": { opacity: "0.85" },
        },
        drift: {
          "0%, 100%": { opacity: "0.5", transform: "translateX(-1%)" },
          "50%": { opacity: "0.9", transform: "translateX(1%)" },
        },
        sweep: {
          "0%, 100%": { transform: "translateX(-4%)" },
          "50%": { transform: "translateX(4%)" },
        },
        pulseRing: {
          "0%": { transform: "scale(.9)", opacity: ".7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        rise: {
          "0%": { transform: "translateY(14px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        pop: "pop .35s cubic-bezier(.2,1.3,.4,1) both",
        pulseRing: "pulseRing 1.4s ease-out infinite",
        rise: "rise .35s ease-out both",
        shake: "shake .4s ease-in-out",
        bob: "bob 2.4s ease-in-out infinite",
        jump: "jump .7s ease-out",
        sway: "sway 3.4s ease-in-out infinite",
        beam: "beam 7s ease-in-out infinite",
        float: "float 10s ease-in-out infinite",
        flicker: "flicker 6s linear infinite",
        drift: "drift 9s ease-in-out infinite",
        sweep: "sweep 11s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
