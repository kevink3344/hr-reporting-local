import { createRuntimeApp } from './app.js';
import { getDataSource } from './config.js';

const port = Number(process.env.PORT ?? 3000);
const runtimeApp = createRuntimeApp();
runtimeApp.listen(port, () => {
  // Log the RESOLVED source, not process.env.DATA_SOURCE: getDataSource() falls
  // back to fixtures (with a warning) when the requested source is
  // misconfigured, so the two can differ. Without this it is easy to believe a
  // .env switch took effect when the server is still serving the old source --
  // .env is not part of the tsx watch graph, so it only applies after a reload.
  console.log(
    `HR Reporting API listening on http://localhost:${port} [DATA_SOURCE=${getDataSource()}]`,
  );
});
