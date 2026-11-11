import { fileURLToPath } from 'node:url';

/** @type {import('@gg-utils/knowledge-dashboard-kit').KnowledgeDashboardKit_Config} */
const config = {
  title: 'Project Knowledge Dashboard',
  collections: [
    { type: 'studies', dir: '.studies', color: '#60a5fa', icon: 'microscope' },
    { type: 'plans', dir: '.plans', color: '#34d399', icon: 'map' },
    { type: 'specs', dir: '.specs', color: '#8b5cf6', icon: 'clipboard' },
  ],
  allowedHiddenCollectionRoots: ['.studies', '.plans', '.specs'],
  docsSources: [{ repoLabel: 'project', dir: 'docs' }],
  githubRepo: 'example/project', // Replace with the consuming repository.
  githubBranch: 'main',
  htmlFilePath: fileURLToPath(new URL('./assets/index.html', import.meta.resolve('@gg-utils/knowledge-dashboard-kit/package.json'))),
  port: {
    defaultPort: 4317,
    canonicalRealmSlug: 'main',
    canonicalPortEnvName: 'KNOWLEDGE_DASHBOARD_PORT',
    realmSlugEnvName: 'KNOWLEDGE_DASHBOARD_REALM',
    portFlags: ['--port'],
    errorPrefix: '[knowledge-dashboard]',
  },
  // These fields only describe an advertised router URL; they grant no remote access.
  realmUrl: {
    subdomain: 'knowledge',
    realmSlugEnvName: 'KNOWLEDGE_DASHBOARD_REALM',
    methodEnvName: 'KNOWLEDGE_DASHBOARD_METHOD',
    developerSlugEnvNames: ['KNOWLEDGE_DASHBOARD_DEVELOPER'],
    rootZoneEnvName: 'KNOWLEDGE_DASHBOARD_ROOT_ZONE',
    listenPortEnvName: 'KNOWLEDGE_DASHBOARD_LISTEN_PORT',
    defaultRealmSlug: 'main',
    defaultMethod: 'local',
    defaultDeveloperSlug: 'dev',
    defaultRootZone: 'example.test',
    defaultListenPort: 443,
  },
};
export default config;
