// Vite's `?raw` suffix imports a file's contents as a string (used to test the committed
// wrangler.jsonc). Declared here instead of pulling in vite/client's browser types.
declare module '*?raw' {
  const content: string;
  export default content;
}
