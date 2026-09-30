import type { Config } from "tailwindcss";

/**
 * Tailwind config — TAFF Sportwear design system.
 * Colors map to CSS variables in app/globals.css (light) overridden
 * under .dark. Shadows + glass utilities also read from CSS vars so
 * theme switching is automatic.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-strong": "var(--color-primary-strong)",
        secondary: "var(--color-secondary)",
        "secondary-strong": "var(--color-secondary-strong)",
        accent: "var(--color-accent)",
        background: "var(--color-background)",
        "background-canvas": "var(--color-background-canvas)",
        "background-bone": "var(--color-background-bone)",
        surface: "var(--color-surface)",
        "surface-card": "var(--color-surface-card)",
        "surface-dark": "var(--color-surface-dark)",
        "surface-deep": "var(--color-surface-deep)",
        foreground: "var(--color-foreground)",
        ink: "var(--color-ink)",
        body: "var(--color-body)",
        charcoal: "var(--color-charcoal)",
        mute: "var(--color-mute)",
        ash: "var(--color-ash)",
        stone: "var(--color-stone)",
        "on-primary": "var(--color-on-primary)",
        "on-secondary": "var(--color-on-secondary)",
        "on-dark": "var(--color-on-dark)",
        "on-dark-mute": "var(--color-on-dark-mute)",
        hairline: "var(--color-hairline)",
        "hairline-strong": "var(--color-hairline-strong)",
        divider: "var(--color-divider)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        info: "var(--color-info)",
        danger: "var(--color-danger)",
        link: "var(--color-link)",
        "ring-focus": "var(--color-ring-focus)",
        // Brand social colors (used as-is, not theme-aware)
        whatsapp: "#25D366",
        instagram: "#E1306C",
        tiktok: "#000000",
        facebook: "#1877F2",
        google: "#4285F4",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      spacing: {
        xxs: "2px",
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        xxl: "32px",
        xxxl: "48px",
        section: "96px",
        band: "120px",
      },
      borderRadius: {
        none: "0",
        xs: "3px",
        sm: "5px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        "3xl": "28px",
        full: "99999px",
      },
      boxShadow: {
        "premium-sm": "var(--shadow-sm)",
        "premium-md": "var(--shadow-md)",
        "premium-lg": "var(--shadow-lg)",
        "premium-xl": "var(--shadow-xl)",
        "premium-glow": "var(--shadow-glow)",
      },
      backdropBlur: {
        xs: "4px",
        glass: "16px",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.2, 0.7, 0.2, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        normal: "200ms",
        slow: "300ms",
        slower: "500ms",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
