const path = require('path');

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
  config: {
    projectName,
    github: { repo, mainBranch },
  },
  commits,
}) =>
  htmlPage(
    { title: `Storybooks for ${projectName} (${repo})` },
    html`
      <h2>Latest ${mainBranch}</h2>
      <ul>
        ${commits
          .filter((item) => item.branch === mainBranch)
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
    <a href="commits/${commit}/index.html">${commit}</a>
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

module.exports = {
  htmlCommitIndex,
  htmlSiteIndex,
  htmlPage,
  html,
};
