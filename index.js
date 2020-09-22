#!/usr/bin/env node
/* eslint no-use-before-define: 0 */
const util = require('util');
const fs = require('fs');
const path = require('path');
const globby = require('globby');
const fetch = require('node-fetch');
const { default: PQueue } = require('p-queue');
const { spawn } = require('child_process');
const exec = util.promisify(require('child_process').exec);
const rimraf = util.promisify(require('rimraf'));
const mkdirp = util.promisify(require('mkdirp'));
const { Storage } = require('@google-cloud/storage');

require('dotenv').config({
  path: path.resolve(process.cwd(), '.storybook-publisher-env'),
  debug: process.env.DEBUG
});

const INITIAL_CWD = process.cwd();

// Config vars from environment
const {
  STORYBOOKS_PROJECT_NAME,
  STORYBOOKS_PROJECT_REPO,
  STORYBOOKS_PACKAGES_ROOT,
  STORYBOOKS_GITHUB_TOKEN,
  STORYBOOKS_GCP_PROJECT_ID,
  STORYBOOKS_GCP_PRIVATE_KEY,
  STORYBOOKS_GCP_CLIENT_EMAIL,
  STORYBOOKS_GCP_BUCKET,
  STORYBOOKS_GCP_MAX_AGE = 1000 * 60 * 60 * 24 * 30,
  STORYBOOKS_NUM_LATEST_ITEMS = 25,
  STORYBOOKS_LOG_LEVEL = 'INFO',
  STORYBOOKS_PROJECT_MAIN_BRANCH = 'main',
  STORYBOOKS_SKIP_BUILD = false,
  STORYBOOKS_SKIP_PUBLISH = false,
  STORYBOOKS_SKIP_GITHUB_STATUS = false,
  STORYBOOKS_UPLOAD_CONCURRENCY = 16,

  CIRCLE_PULL_REQUEST,
  CIRCLE_BRANCH,
} = process.env;

// These config vars have defaults based on other config vars
const {
  STORYBOOKS_PUBLIC_BASE_URL = `https://storage.googleapis.com/${STORYBOOKS_GCP_BUCKET}`,
} = process.env;

const storage = new Storage({
  projectId: STORYBOOKS_GCP_PROJECT_ID,
  credentials: {
    client_email: STORYBOOKS_GCP_CLIENT_EMAIL,
    private_key: STORYBOOKS_GCP_PRIVATE_KEY,
  },
});
const bucket = storage.bucket(STORYBOOKS_GCP_BUCKET);
const log = createLog(STORYBOOKS_LOG_LEVEL);

async function main() {
  const context = {
    commitMetadata: await getCommitMetadata(STORYBOOKS_PACKAGES_ROOT),
    storybookPackages: await findStorybookPackages(),
  };

  if (context.storybookPackages.length === 0) {
    exit('No storybook packages to handle - exiting.');
  }

  await buildStorybooks(context);

  context.storybookBuilds = await findStorybookBuilds();
  if (context.storybookBuilds.length === 0) {
    exit('No storybook build found - exiting.');
  }

  await publishStorybooks(context);
  await updateGithubStatusCheck(context);
  await updateSiteIndex(context);
}

async function buildStorybooks(context) {
  const { storybookPackages } = context;
  if (STORYBOOKS_SKIP_BUILD) {
    log.info('Skipping storybooks build');
    return;
  }
  for (const storybookPath of storybookPackages) {
    await buildStorybook(storybookPath);
  }
}

async function publishStorybooks({ commitMetadata, storybookBuilds }) {
  if (STORYBOOKS_SKIP_PUBLISH) {
    log.info('Skipping storybooks publish');
    return;
  }

  const { commit } = commitMetadata;
  const publishBasePath = `commits/${commit}`;

  await publishContent(
    `${publishBasePath}/index.html`,
    htmlCommitIndex({ commitMetadata, storybookBuilds })
  );

  await publishContent(
    `commits/metadata-${commit}.json`,
    JSON.stringify(commitMetadata, null, '  '),
    { contentType: 'application/json' }
  );

  for (const storybookBuildPath of storybookBuilds) {
    const storybookPackage = path.basename(path.dirname(storybookBuildPath));
    log.verbose(`Uploading build for ${storybookPackage}`);
    await uploadStorybookBuild(
      storybookBuildPath,
      `${publishBasePath}/${storybookPackage}`
    );
  }

  log.info(
    `Published storybooks to ${STORYBOOKS_PUBLIC_BASE_URL}/${publishBasePath}/index.html`
  );
}

async function updateGithubStatusCheck({ commitMetadata: { commit } }) {
  if (STORYBOOKS_SKIP_GITHUB_STATUS) {
    log.info('Skipping github status');
    return;
  }

  if (!STORYBOOKS_GITHUB_TOKEN) {
    log.warn('Skipping Github status check update - missing access token');
    return;
  }

  const commitUrl = `${STORYBOOKS_PUBLIC_BASE_URL}/commits/${commit}/index.html`;
  const apiUrl = `https://api.github.com/repos/${STORYBOOKS_PROJECT_REPO}/statuses/${commit}`;
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.github.v3+json',
      Authorization: `token ${STORYBOOKS_GITHUB_TOKEN}`,
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

async function updateSiteIndex(context) {
  const [allMetadataFiles] = await bucket.getFiles({
    prefix: 'commits/metadata-',
  });

  const now = Date.now();

  const latestMetadataFiles = allMetadataFiles
    .filter(
      (file) =>
        now - new Date(file.metadata.timeCreated).getTime() <=
        STORYBOOKS_GCP_MAX_AGE
    )
    .sort(
      (a, b) =>
        new Date(b.metadata.timeCreated).getTime() -
        new Date(a.metadata.timeCreated).getTime()
    )
    .slice(0, STORYBOOKS_NUM_LATEST_ITEMS);

  const commits = [];
  for (const metadataFile of latestMetadataFiles) {
    const [file] = await metadataFile.download();
    try {
      commits.push(JSON.parse(file.toString('utf-8')));
    } catch (err) {
      log.warn(
        'Failure to parse commit metadata file',
        file.metadata.name,
        err
      );
    }
  }

  await publishContent(`index.html`, htmlSiteIndex({ ...context, commits }));
}

async function findStorybookPackages() {
  const storybookDirectories = globby.stream(
    `${STORYBOOKS_PACKAGES_ROOT}/**/.storybook`,
    { deep: 2, onlyDirectories: true }
  );

  const storybookPackages = [];
  for await (const entry of storybookDirectories) {
    storybookPackages.push(path.dirname(entry));
  }

  return storybookPackages;
}

async function buildStorybook(storybookPath) {
  const packageName = path.basename(storybookPath);
  log.info(`Building storybook for ${packageName}`);

  process.chdir(storybookPath);
  await rimraf('storybook-static');
  await execVerbose(`yarn workspaces focus ${packageName}`);
  await execVerbose(`yarn run build-storybook`);

  // TODO: Fixup css and such!
  /*
  # HACK: fixup some generated CSS paths to static media that break since the
  # storybooks are no longer at the root of the site. Would be better to
  # figure out how to reconfigure storybook to do this, but I got here faster
  for CSS_FN in $(find $COMMIT_PATH -type f -name 'main*.css'); do
      sed --in-place 's:url(static/:url(../../static/:g' $CSS_FN
  done
  */

  process.chdir(INITIAL_CWD);
}

async function uploadStorybookBuild(storybookBuildPath, uploadPath) {
  const buildFiles = globby.stream(`${storybookBuildPath}/**/*`, {
    onlyFiles: true,
  });
  const uploadQueue = new PQueue({
    concurrency: STORYBOOKS_UPLOAD_CONCURRENCY,
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

async function getCommitMetadata(storybookPackagesRoot) {
  process.chdir(storybookPackagesRoot);

  const datestamp = Date.now();

  const commit = await execCapture('git rev-parse HEAD');
  const summary = await execCapture("git log -n 1 --no-color --pretty='%s'");
  const description = await execCapture(
    'git log -n 1 --no-color --pretty=medium'
  );

  let branch;
  if (CIRCLE_BRANCH) {
    branch = CIRCLE_BRANCH;
  } else {
    branch = await execCapture(
      'git rev-parse --symbolic-full-name --abbrev-ref HEAD'
    );
  }

  let pullRequest, pullRequestURL;
  if (CIRCLE_PULL_REQUEST) {
    pullRequestURL = CIRCLE_PULL_REQUEST;
    pullRequest = CIRCLE_PULL_REQUEST.split('/').pop();
  }

  process.chdir(INITIAL_CWD);

  return {
    datestamp,
    commit,
    branch,
    pullRequest,
    pullRequestURL,
    summary,
    description,
  };
}

function exit(message, status = 0) {
  log.info(message);
  process.exit(status);
}

async function findStorybookBuilds() {
  return await globby(`${STORYBOOKS_PACKAGES_ROOT}/**/storybook-static`, {
    deep: 2,
    onlyDirectories: true,
  });
}

async function execCapture(command) {
  return (await exec(command)).stdout.trim();
}

async function execVerbose(command) {
  const [exe, ...args] = command.split(' ');
  return new Promise((resolve, reject) => {
    log.debug('Running', exe, args);
    const child = spawn(exe, args);
    log.useLevel('VERBOSE') && child.stdout.pipe(process.stdout);
    log.useLevel('ERROR') && child.stderr.pipe(process.stderr);
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve(code));
  });
}

async function publishContent(
  name = 'index.html',
  content,
  metadata = { contentType: 'text/html' }
) {
  return bucket.file(name).save(content, { metadata });
}

const htmlCommitIndex = ({
  commitMetadata: { datestamp, commit, summary, description },
  storybookBuilds,
}) => {
  const title = `Storybooks for commit ${commit}`;
  return htmlPage(
    { title },
    html`
      <ul>
        ${storybookBuilds.map((buildPath) => {
          const buildName = path.basename(path.dirname(buildPath));
          return html`
            <li><a href="./${buildName}/index.html">${buildName}</a></li>
          `;
        })}
      </ul>

      <dl>
        <dt>Date</dt>
        <dd>${new Date(datestamp).toISOString()}</dd>
        <dt>Summary</dt>
        <dd><pre>${summary}</pre></dd>
        <dt>Description</dt>
        <dd><pre>${description}</pre></dd>
      </dl>
    `
  );
};

const htmlSiteIndex = ({
  title = `Storybooks for ${STORYBOOKS_PROJECT_NAME} (${STORYBOOKS_PROJECT_REPO})`,
  commits,
}) =>
  htmlPage(
    { title },
    html`
      <h2>Latest ${STORYBOOKS_PROJECT_MAIN_BRANCH}</h2>
      <ul>
        ${commits
          .filter((item) => item.branch === STORYBOOKS_PROJECT_MAIN_BRANCH)
          .slice(0, 3)
          .map(htmlCommitItem)}
      </ul>
      <h2>Pull Requests</h2>
      <ul>
        ${commits.filter((item) => !!item.pullRequest).map(htmlCommitItem)}
      </ul>
      <h2>Commits</h2>
      <ul>
        ${commits.map(htmlCommitItem)}
      </ul>
    `
  );

const htmlCommitItem = ({
  datestamp,
  commit,
  summary,
  branch,
  pullRequest,
  pullRequestURL,
}) => html`
  <li>
    ${pullRequest &&
    html`<span>PR #<a href="${pullRequestURL}">${pullRequest}</a></span>`}
    <a href="commit/${commit}/index.html">${commit}</a>
    (<span>${new Date(datestamp).toISOString()}</span>)
    <pre>${summary}</pre>
  </li>
`;

const htmlPage = ({ title = '', head = '' }, body) => html`
  <!DOCTYPE html>
  <html>
    <head>
      <title>${title}</title>
      ${head}
    </head>
    <body>
      <h1>${title}</h1>
      ${body}
    </body>
  </html>
`;

// Simple html tagged template utility. Could do more, but it helps a bit with
// using the lit-html extension in VSCode to keep markup in strings formatted.
const html = (strings, ...values) =>
  strings
    .reduce(
      (result, string, i) =>
        result +
        string +
        (values[i]
          ? Array.isArray(values[i])
            ? values[i].join('')
            : values[i]
          : ''),
      ''
    )
    .trim();

// TODO: Maybe need a "real" logging package here someday?
function createLog(
  level,
  levels = {
    ALL: 999,
    TRACE: 60,
    DEBUG: 50,
    VERBOSE: 45,
    INFO: 40,
    WARN: 30,
    ERROR: 20,
    FATAL: 10,
    OFF: 0,
  }
) {
  const useLevel = (level) => levels[level] >= levels[level];
  const log = (atLevel, ...args) => useLevel(atLevel) && console.log(...args);
  const mklog = (atLevel) => (...args) => log(atLevel, ...args);
  return {
    level,
    useLevel,
    log,
    debug: mklog('DEBUG'),
    verbose: mklog('VERBOSE'),
    info: mklog('INFO'),
    warn: mklog('WARN'),
    error: mklog('ERROR'),
    fatal: mklog('FATAL'),
  };
}

main()
  .then()
  .catch((err) => {
    log.error(err);
    process.exit(1);
  });
