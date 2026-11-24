// Tailwind settings: files to scan, fonts, and the spec 11.1 colour palette (all pass WCAG AA).
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Hind Siliguri', 'system-ui', 'sans-serif'],
        bn: ['Hind Siliguri', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#1D4ED8', // Oleyn Blue: top bar, primary buttons (white text)
          light: '#2563EB',   // Sky Blue: links, active tab, focus ring
          dark: '#1E3A8A',    // Deep Navy: page titles, big numbers
          tint: '#EFF6FF',    // Mist Blue: page background, selected rows
        },
        accent: {
          DEFAULT: '#F97316', // Signal Orange: due badges, low-stock dots, "Check this" (dark text only)
          text: '#C2410C',    // Rust: warnings, errors, overdue amounts, negative stock
          tint: '#FFF7ED',    // Peach: offline banner, AI low-confidence fields
          ink: '#9A3412',     // Rust-dark: text on Peach
        },
        ink: '#0F172A',       // body text
        slate: '#64748B',     // hints, timestamps
        cloud: '#E2E8F0',     // borders, dividers
      },
    },
  },
  plugins: [],
};
