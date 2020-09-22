#!/usr/bin/env node
/* eslint no-use-before-define: 0 */
const { Command } = require('commander');
const fs = require('fs');
const util = require('util');
const path = require('path');
const globby = require('globby');
const fetch = require('node-fetch');
const { default: PQueue } = require('p-queue');
const rimraf = util.promisify(require('rimraf'));
const mkdirp = util.promisify(require('mkdirp'));
const { Storage } = require('@google-cloud/storage');
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const {
  exit,
  execCapture,
  execVerbose,
  publishContent,
} = require('./lib/utils');
const loadConfig = require('./lib/config');
const createLog = require('./lib/log');
const { htmlCommitIndex, htmlSiteIndex } = require('./lib/html');

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
    .option('--skip-build', 'skip storybook build')
    .option('--skip-publish', 'skip storybook pusblish')
    .option('--skip-status', 'skip setting github status check')
    .version(ourPackageMeta.version);

  program.parse(process.argv);

  if (program.dir) process.chdir(program.dir);

  const initialCwd = process.cwd();

  const config = await loadConfig(program.config, {
    skip: {
      build: !!program.skipBuild,
      publish: !!program.skipPublish,
      status: !!program.skipStatus,
    },
  });

  const storage = new Storage({
    projectId: config.gcp.projectId,
    credentials: {
      client_email: config.gcp.clientEmail,
      private_key: config.gcp.privateKey,
    },
  });

  const bucket = storage.bucket(config.gcp.bucket);

  const log = createLog(config.logLevel);

  return {
    program,
    initialCwd,
    config,
    storage,
    bucket,
    log,
  };
}

async function getCommitMetadata(context) {
  const { config, initialCwd } = context;

  const storybookPackagesRoot = config.packagesRoot;
  process.chdir(storybookPackagesRoot);

  const datestamp = Date.now();

  const commit = await execCapture('git rev-parse HEAD');
  const summary = await execCapture("git log -n 1 --no-color --pretty='%s'");
  const description = await execCapture(
    'git log -n 1 --no-color --pretty=medium'
  );

  let branch;
  if (config.ci.branch) {
    branch = config.ci.branch;
  } else {
    branch = await execCapture(
      'git rev-parse --symbolic-full-name --abbrev-ref HEAD'
    );
  }

  let pullRequest, pullRequestURL;
  if (config.ci.pullRequest) {
    pullRequestURL = config.ci.pullRequest;
    pullRequest = pullRequestURL.split('/').pop();
  }

  process.chdir(initialCwd);

  context.commitMetadata = {
    datestamp,
    commit,
    branch,
    pullRequest,
    pullRequestURL,
    summary,
    description,
  };
}

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
  const { initialCwd, log } = context;
  const packageName = path.basename(storybookPath);
  log.info(`Building storybook for ${packageName}`);

  process.chdir(storybookPath);
  await rimraf('storybook-static');
  await execVerbose(context, `yarn workspaces focus ${packageName}`);
  await execVerbose(context, `yarn run build-storybook`);

  process.chdir(initialCwd);
}

async function publishStorybooks(context) {
  const { log, config, commitMetadata, storybookBuilds } = context;

  if (config.skip.publish) {
    return log.info('Skipping storybooks publish');
  }

  const { commit } = commitMetadata;
  const publishBasePath = `commits/${commit}`;

  // Publish a JSON metadata resource for this batch of storybooks.
  // Note: This is not in the same "folder" as the rest, because
  // this `commits/metadata-` prefix is easier to search for later.
  await publishContent(
    context,
    `commits/metadata-${commit}.json`,
    JSON.stringify(commitMetadata, null, '  '),
    { contentType: 'application/json' }
  );

  // Publish an index page for this batch of storybooks
  await publishContent(
    context,
    `${publishBasePath}/index.html`,
    htmlCommitIndex({ commitMetadata, storybookBuilds })
  );

  // Finally, upload each storybook in this batch.
  for (const storybookBuildPath of storybookBuilds) {
    const storybookPackage = path.basename(path.dirname(storybookBuildPath));
    log.verbose(`Uploading build for ${storybookPackage}`);
    await uploadStorybookBuild(
      context,
      storybookBuildPath,
      `${publishBasePath}/${storybookPackage}`
    );
  }

  log.info(
    `Published storybooks to ${config.gcp.publicUrl}/${publishBasePath}/index.html`
  );
}

async function findStorybookBuilds({ config }) {
  return await globby(`${config.packagesRoot}/**/storybook-static`, {
    deep: config.packagesDepth,
    onlyDirectories: true,
    ignore: ['node_modules/**/*'],
  });
}

async function uploadStorybookBuild(
  { log, config, bucket },
  storybookBuildPath,
  uploadPath
) {
  const buildFiles = globby.stream(`${storybookBuildPath}/**/*`, {
    onlyFiles: true,
    ignore: ['node_modules/**/*'],
  });
  const uploadQueue = new PQueue({
    concurrency: config.gcp.uploadConcurrency,
  });
  for await (const buildFile of buildFiles) {
    const destination = buildFile.replace(storybookBuildPath, uploadPath);
    uploadQueue.add(async () => {
      await bucket.upload(buildFile, { destination });
      log.debug(`\t${destination}`);
    });
  }
  return await uploadQueue.onIdle();
}

async function updateGithubStatusCheck({
  log,
  config,
  commitMetadata: { commit },
}) {
  if (config.skip.status) {
    return log.info('Skipping github status');
  }

  if (!config.github.token) {
    return log.warn(
      'Skipping Github status check update - missing access token'
    );
  }

  const commitUrl = `${config.gcp.publicUrl}/commits/${commit}/index.html`;
  const apiUrl = `https://api.github.com/repos/${config.github.repo}/statuses/${commit}`;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.github.v3+json',
      Authorization: `token ${config.github.token}`,
    },
    body: JSON.stringify({
      state: 'success',
      context: 'storybooks: pull request',
      description: `Storybook deployment for ${commit}`,
      target_url: commitUrl,
    }),
  });

  if (resp.status !== 201) {
    throw new Error(`Failed to update Github status ${await resp.text()}`);
  }

  const data = await resp.json();
  log.info(`Updated Github status check - id: ${data.id}`);
  log.debug(data);
}

const getTime = (ts) => new Date(ts).getTime();

async function updateSiteIndex(context) {
  const { log, config, bucket } = context;
  const now = Date.now();

  // Assemble a limited list of the latest build metadata files.
  const [allMetadataFiles] = await bucket.getFiles({
    prefix: 'commits/metadata-',
  });
  const latestMetadataFiles = allMetadataFiles
    .filter(
      (file) => now - getTime(file.metadata.timeCreated) <= config.gcp.maxAge
    )
    .sort(
      (a, b) =>
        getTime(b.metadata.timeCreated) - getTime(a.metadata.timeCreated)
    )
    .slice(0, config.numLatestItems);

  // Load up all the selected latest build metadata files.
  const commits = [];
  for (const metadataFile of latestMetadataFiles) {
    const [file] = await metadataFile.download();
    try {
      const data = file.toString('utf-8');
      const meta = JSON.parse(data);
      commits.push(meta);
    } catch (err) {
      log.warn(
        'Failure to parse commit metadata file',
        file.metadata.name,
        err
      );
    }
  }

  // Publish a new site index file based on the latest build metadata files.
  await publishContent(
    context,
    `index.html`,
    htmlSiteIndex({ ...context, commits })
  );
}

main()
  .then()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
