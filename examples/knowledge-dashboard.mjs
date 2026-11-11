import { knowledgeDashboardKitResolvePort, knowledgeDashboardKitStartServer } from '@gg-utils/knowledge-dashboard-kit';
import config from './knowledge-dashboard.config.mjs';

const { port } = knowledgeDashboardKitResolvePort({
  activeEnvFilePaths: [],
  argv: process.argv.slice(2),
  config: config.port,
  env: process.env,
});
knowledgeDashboardKitStartServer({ config, env: process.env, port, projectRoot: process.cwd() });
