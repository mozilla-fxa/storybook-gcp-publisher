# storybook-gcp-publisher

This is a utility intended for use with CircleCI which does the following:

1. Build [Storybooks][storybook] for a project

1. Publish those Storybook builds as a [static website][] on the Google Cloud Platform

1. Post a Github [status check][] for the commit that links to the Storybook builds

## Usage

The intended use for this utility is as a build job in CircleCI, e.g.:

```
  build-and-deploy-storybooks:
    resource_class: small
    docker:
      - image: circleci/node:12
    steps:
      - run:
          name: Build and deploy Storybooks
          command: npx github:lmorchard/storybook-gcp-publisher
```

## Configuration

### Basic

This utility requires a [static website hosted on Google Cloud Storage](https://cloud.google.com/storage/docs/hosting-static-website) and credentials to manage that site's bucket.

A [Github personal access token](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) is also required for posting status check updates.

Credentials for Github and GCP should be configured in environmental variables:

* `STORYBOOKS_GITHUB_TOKEN` - personal access token on GitHub for use in posting status check updates

* `STORYBOOKS_GCP_BUCKET` - name of the GCP bucket to which Storybook builds will be uploaded

* `STORYBOOKS_GCP_PROJECT_ID` - the ID of the GCP project to which the bucket belongs

* `STORYBOOKS_GCP_CLIENT_EMAIL` - client email address from GCP credentials with access to the bucket

* `STORYBOOKS_GCP_PRIVATE_KEY_BASE64` - the private key from GCP credentials, encoded with base64 to accomodate linebreaks

  * See also: [Using Multiple Line(newline) Environment Variables in CircleCI](https://support.circleci.com/hc/en-us/articles/360046094254-Using-Multiple-Line-newline-Environment-Variables-in-CircleCI)

### Advanced

Check [./lib/config.js](./lib/config.js) for the complete configuration schema.

Most configuration options have defaults or will be derived from environment variables and `package.json` in the current working directory. The current working directory can be changed with the `--dir` option, if necessary.

Per-project configuration can be specified with an object in `package.json` under the key `storybookPublisher`.

Alternatively, a JSON file may be specified with the `--config` command line option.

[status check]: https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/about-status-checks
[static website]: https://cloud.google.com/storage/docs/hosting-static-website
[storybook]: https://storybook.js.org/