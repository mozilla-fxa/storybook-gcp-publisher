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

module.exports = createLog;