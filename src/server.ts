import { createRuntimeApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const runtimeApp = createRuntimeApp();
runtimeApp.listen(port, () => {
  console.log(`HR Reporting API listening on http://localhost:${port}`);
});
