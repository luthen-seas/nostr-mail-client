/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        mail: {
          bg: '#f8f9fa',
          sidebar: '#1a1a2e',
          accent: '#6366f1',
          'accent-hover': '#4f46e5',
          unread: '#3b82f6',
          border: '#e5e7eb',
          muted: '#6b7280',
        }
      }
    }
  },
  plugins: []
};
