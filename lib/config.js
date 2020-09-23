const path = require('path');
const convict = require('convict');

const configSchema = {
  logLevel: {
    doc: 'log verbosity level (e.g. INFO, DEBUG)',
    format: String,
    default: 'INFO',
    env: 'LOG_LEVEL',
  },
  debug: {
    doc: 'whether to enable debug features',
    format: Boolean,
    default: false,
    env: 'DEBUG',
  },
  skip: {
    build: {
      doc: 'skip building storybooks',
      env: 'STORYBOOKS_SKIP_BUILD',
      format: Boolean,
      default: false,
    },
    publish: {
      doc: 'skip publishing storybooks',
      env: 'STORYBOOKS_SKIP_PUBLISH',
      format: Boolean,
      default: false,
    },
    status: {
      doc: 'skip updating github status',
      env: 'STORYBOOKS_SKIP_STATUS',
      format: Boolean,
      default: false,
    },
  },
  numLatestItems: {
    doc: 'how many latest builds to query for front page index',
    env: 'STORYBOOKS_NUM_LATEST_ITEMS',
    default: 25,
  },
  projectName: {
    doc: 'human readable name for the project',
    format: String,
    env: 'STORYBOOKS_PROJECT_NAME',
    default: null,
  },
  useYarnWorkspaces: {
    doc:
      'whether or not to call `yarn workspaces focus {package}` before build',
    format: Boolean,
    env: 'STORYBOOKS_USE_YARN_WORKSPACES',
    default: true,
  },
  packagesRoot: {
    doc: 'path to packages where storybook configs are found',
    format: String,
    default: '.',
    env: 'STORYBOOKS_PACKAGES_ROOT',
  },
  packagesDepth: {
    doc: 'depth for file search in finding storybook packages',
    format: Number,
    default: 3,
    env: 'STORYBOOKS_PACKAGES_DEPTH',
  },
  ci: {
    branch: {
      doc: 'branch for current CI run',
      format: String,
      default: '',
      env: 'CIRCLE_BRANCH',
    },
    pullRequest: {
      doc: 'pull request URL for current CI run',
      format: String,
      default: '',
      env: 'CIRCLE_PULL_REQUEST',
    },
  },
  github: {
    repo: {
      doc: 'Github owner and repository for project (e.g. mozilla/fxa)',
      format: String,
      env: 'STORYBOOKS_PROJECT_REPO',
      default: null,
    },
    mainBranch: {
      doc: 'main branch for git repo',
      format: String,
      env: 'STORYBOOKS_PROJECT_MAIN_BRANCH',
      default: 'main',
    },
    token: {
      doc: 'Github personal access token used to update status checks',
      format: String,
      default: null,
      env: 'STORYBOOKS_GITHUB_TOKEN',
      sensitive: true,
    },
  },
  gcp: {
    publicUrl: {
      doc: 'public URL for storybook site',
      format: String,
      env: 'STORYBOOKS_PUBLIC_BASE_URL',
      default: null,
    },
    bucket: {
      doc: 'Google Cloud bucket for publishing',
      format: String,
      default: null,
      env: 'STORYBOOKS_GCP_BUCKET',
    },
    projectId: {
      doc: 'Google Cloud project ID for publishing',
      format: String,
      default: null,
      env: 'STORYBOOKS_GCP_PROJECT_ID',
    },
    clientEmail: {
      doc: 'Google Cloud credentials client_email for publishing',
      format: String,
      default: null,
      env: 'STORYBOOKS_GCP_CLIENT_EMAIL',
      sensitive: true,
    },
    privateKey: {
      doc: 'Google Cloud credentials private_key for publishing',
      format: String,
      default: null,
      env: 'STORYBOOKS_GCP_PRIVATE_KEY',
      sensitive: true,
    },
    maxAge: {
      doc: 'Google Cloud maximum age for published resources',
      format: Number,
      default: 1000 * 60 * 60 * 24 * 30,
      env: 'STORYBOOKS_GCP_MAX_AGE',
    },
    uploadConcurrency: {
      doc: 'how many files to simultaneously attempt to upload',
      format: Number,
      default: 16,
      env: 'STORYBOOKS_UPLOAD_CONCURRENCY',
    },
  },
};

module.exports = async function loadConfig(filename, options = {}, check = false) {
  const env = { ...process.env };

  // HACK: private keys have linebreaks, so accept a base64-encoded version
  if (env.STORYBOOKS_GCP_PRIVATE_KEY_BASE64) {
    env.STORYBOOKS_GCP_PRIVATE_KEY = Buffer.from(
      env.STORYBOOKS_GCP_PRIVATE_KEY_BASE64,
      'base64'
    ).toString('ascii');
  }

  const config = convict(configSchema, { env, args: [] });

  let projectPackageMeta = {};
  try {
    projectPackageMeta = require(path.join(process.cwd(), 'package.json'));
  } catch (err) {
    // no-op
  }

  if (projectPackageMeta.storybookPublisher) {
    config.load(projectPackageMeta.storybookPublisher);
  }
  if (filename) {
    config.loadFile(filename);
  }
  config.load(options);

  if (!config.get('projectName') && projectPackageMeta.name) {
    config.set(
      'projectName',
      projectPackageMeta.description || projectPackageMeta.name
    );
  }

  if (
    !config.get('github.repo') &&
    projectPackageMeta.repository &&
    projectPackageMeta.repository.type === 'git'
  ) {
    config.set(
      'github.repo',
      projectPackageMeta.repository.url.split('/').slice(-2).join('/')
    );
  }

  if (!config.get('gcp.publicUrl')) {
    config.set(
      'gcp.publicUrl',
      `https://storage.googleapis.com/${config.get('gcp.bucket')}`
    );
  }

  config.validate({ allowed: 'strict' });

  if (check) {
    console.log(config.toString());
    process.exit();
  }

  return config.getProperties();
};
