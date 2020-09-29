const path = require('path');
const globby = require('globby');
const { default: PQueue } = require('p-queue');
const { exit } = require('./utils');
const { htmlCommitIndex, htmlSiteIndex } = require('./html');

async function publishStorybooks(context) {
  const { log, config, commitMetadata } = context;

  const storybookBuilds = await findStorybookBuilds(context);
  if (storybookBuilds.length === 0) {
    exit(context, 'No storybook build found - exiting.');
  }
  context.storybookBuilds = storybookBuilds;

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

async function publishContent(
  { bucket },
  name = 'index.html',
  content,
  metadata = { contentType: 'text/html' }
) {
  return bucket.file(name).save(content, { metadata });
}

module.exports = { publishStorybooks, updateSiteIndex };
