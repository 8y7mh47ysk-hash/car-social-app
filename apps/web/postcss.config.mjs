// Next.js, and Vite in the web tests, compile src/app/globals.css through this file with Tailwind
// CSS. Tailwind CSS takes class names only from the sources that globals.css names, so it must not
// find the one in this comment, outside them: src/app/globals.test.ts checks that the stylesheet
// has no rule for `[--sentinel-outside-src:1]`.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
