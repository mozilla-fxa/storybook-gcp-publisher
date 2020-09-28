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
  commit: {
    versionJson: {
      doc: 'version.json file from which to read commit hash',
      format: String,
      default: '',
      env: 'STORYBOOKS_VERSION_JSON',
    },
    commitBranch: {
      doc: 'git branch from which this commit originated',
      format: String,
      default: '',
      env: 'STORYBOOKS_COMMIT_BRANCH',
    },
    commitSummary: {
      doc: 'text file from which to read commit summary',
      format: String,
      default: '',
      env: 'STORYBOOKS_COMMIT_SUMMARY_FILE',
    },
    commitDescription: {
      doc: 'text file from which to read commit description',
      format: String,
      default: '',
      env: 'STORYBOOKS_COMMIT_DESCRIPTION_FILE',
    },
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

async function setupConfigOptions(program) {
  program
    .option('-c, --config <file>', 'local config JSON file')
    .option('--version-json <file>', 'read commit info from version.json')
    .option(
      '--commit-branch <branch',
      'name of branch from which this commit came'
    )
    .option('--commit-summary <file>', 'read commit summary from file')
    .option('--commit-description <file>', 'read commit summary from file')
    .option('--check-config', 'dump config settings to console and exit')
    .option('--check-sensitive-config', 'dump config settings to console without sensitive values censored and exit')
    .option('--skip-build', 'skip storybook build')
    .option('--skip-publish', 'skip storybook publish')
    .option('--skip-status', 'skip setting github status check');
}

async function loadConfig(program) {
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

  if (program.config) {
    config.loadFile(program.config);
  }

  config.load({
    skip: {
      build: !!program.skipBuild,
      publish: !!program.skipPublish,
      status: !!program.skipStatus,
    },
  });

  if (program.logLevel) config.set('logLevel', program.logLevel);

  for (const name of [
    'versionJson',
    'commitBranch',
    'commitSummary',
    'commitDescription',
  ]) {
    if (program[name]) config.set(`commit.${name}`, program[name]);
  }

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

  if (program.checkConfig) {
    console.log(config.toString());
    process.exit();
  }

  if (program.checkSensitiveConfig) {
    console.log(JSON.stringify(config.getProperties(), null, '  '));
    process.exit();
  }

  return config.getProperties();
}

module.exports = { setupConfigOptions, loadConfig };
