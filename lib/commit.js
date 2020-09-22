const { execCapture } = require('./utils');

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

module.exports = { getCommitMetadata };
