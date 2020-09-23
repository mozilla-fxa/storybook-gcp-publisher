#!/usr/bin/env node
/* eslint no-use-before-define: 0 */
const { Command } = require('commander');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const loadConfig = require('./lib/config');
const createLog = require('./lib/log');
const { getCommitMetadata } = require('./lib/commit');
const { buildStorybooks } = require('./lib/build');
const { publishStorybooks, updateSiteIndex } = require('./lib/publish');
const { updateGithubStatusCheck } = require('./lib/status');

async function main() {
  const context = await initContext();
  await getCommitMetadata(context);
  await buildStorybooks(context);
  await publishStorybooks(context);
  await updateGithubStatusCheck(context);
  await updateSiteIndex(context);
}

async function initContext() {
  const ourPackageMeta = require(path.join(__dirname, 'package.json'));

  const program = new Command();

  program
    .option('-d, --dir <path>', 'working directory')
    .option('-c, --config <file>', 'local config JSON file')
    .option('-l, --log-level <level>', 'log level')
    .option('--check-config', 'dump config settings to console and exit')
    .option('--skip-build', 'skip storybook build')
    .option('--skip-publish', 'skip storybook publish')
    .option('--skip-status', 'skip setting github status check')
    .version(ourPackageMeta.version);

  program.parse(process.argv);

  if (program.dir) process.chdir(program.dir);

  const initialCwd = process.cwd();

  const options = {
    skip: {
      build: !!program.skipBuild,
      publish: !!program.skipPublish,
      status: !!program.skipStatus,
    },
  };
  if (program.logLevel) options.logLevel = program.logLevel;

  const config = await loadConfig(program.config, options, program.checkConfig);

  const log = createLog(config.logLevel);

  const storage = new Storage({
    projectId: config.gcp.projectId,
    credentials: {
      client_email: config.gcp.clientEmail,
      private_key: config.gcp.privateKey,
    },
  });

  const bucket = storage.bucket(config.gcp.bucket);

  return {
    program,
    initialCwd,
    config,
    storage,
    bucket,
    log,
  };
}

main()
  .then()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
