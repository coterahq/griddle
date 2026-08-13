/// <reference types="vite/client" />

// Declares Vite's asset-import forms — `import x from './a.css?url'` and the
// bare `import './a.css'` side effect. The root tsconfig pins `types` to the
// test globals, so this reference is what brings them into the examples app
// without widening the library's own compilation.
