const util = require('util');
const { spawn } = require('child_process');
const exec = util.promisify(require('child_process').exec);

function exit({ log }, message, status = 0) {
  log.info(message);
  process.exit(status);
}

async function execCapture(command) {
  return (await exec(command)).stdout.trim();
}

async function execVerbose({ log }, command) {
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

module.exports = {
  exit,
  execCapture,
  execVerbose,
};
