export default {
  // Tailwind scans these files to find which CSS utility classes are used.
  // Only those classes will be included in the final CSS bundle.
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
