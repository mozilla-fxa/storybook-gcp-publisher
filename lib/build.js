const globby = require('globby');
const util = require('util');
const path = require('path');
const rimraf = util.promisify(require('rimraf'));

const {
  exit,
  execVerbose,
} = require('./utils');

async function buildStorybooks(context) {
  const { log, config } = context;

  const storybookPackages = await findStorybookPackages(context);
  if (storybookPackages.length === 0) {
    exit(context, 'No storybook packages to handle - exiting.');
  }
  context.storybookPackages = storybookPackages;

  if (config.skip.build) {
    return log.info('Skipping storybooks build');
  }

  for (const storybookPath of storybookPackages) {
    await buildStorybook(context, storybookPath);
  }
}

async function findStorybookPackages({ config }) {
  const storybookDirectories = globby.stream(
    `${config.packagesRoot}/**/.storybook`,
    {
      deep: config.packagesDepth,
      onlyDirectories: true,
      ignore: ['node_modules/**/*'],
    }
  );

  const storybookPackages = [];
  for await (const entry of storybookDirectories) {
    storybookPackages.push(path.dirname(entry));
  }

  return storybookPackages;
}

async function buildStorybook(context, storybookPath) {
  const { config, initialCwd, log } = context;
  const packageName = path.basename(storybookPath);
  log.info(`Building storybook for ${packageName}`);

  process.chdir(storybookPath);
  await rimraf('storybook-static');
  if (config.useYarnWorkspaces) {
    await execVerbose(context, `yarn workspaces focus ${packageName}`);
  }
  await execVerbose(context, `yarn run build-storybook`);
  process.chdir(initialCwd);
}

module.exports = { buildStorybooks };