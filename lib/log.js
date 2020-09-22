// TODO: Maybe need a "real" logging package here someday?
function createLog(
  maxLevel,
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
  const useLevel = (atLevel) => levels[atLevel] <= levels[maxLevel];
  const log = (atLevel, ...args) => useLevel(atLevel) && console.log(...args);
  const logAtLevel = (atLevel) => (...args) => log(atLevel, ...args);
  return {
    maxLevel,
    useLevel,
    log,
    debug: logAtLevel('DEBUG'),
    verbose: logAtLevel('VERBOSE'),
    info: logAtLevel('INFO'),
    warn: logAtLevel('WARN'),
    error: logAtLevel('ERROR'),
    fatal: logAtLevel('FATAL'),
  };
}

module.exports = createLog;