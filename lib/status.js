const fetch = require('node-fetch');

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

module.exports = { updateGithubStatusCheck };