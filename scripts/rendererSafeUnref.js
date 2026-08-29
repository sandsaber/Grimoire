// The exit-handler call in the two expression patterns below matches any method
// name: the sdk swapped its tracked-process Set for a tracker object between
// 0.3.229 and 0.3.233, turning `set.delete(child)` into `tracker.untrack(child)`.
// The surrounding kill-timer body is what actually pins these matches, so a
// rename there must not silently drop the patch and fail the build instead.
const UNSAFE_TIMER_UNREF_PATTERNS = [
  {
    name: 'claude-sdk-process-transport-close-win32',
    pattern: /if \(([A-Za-z_$][A-Za-z0-9_$]*) && !\1\.killed && \1\.exitCode === null\) setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*), ([A-Za-z_$][A-Za-z0-9_$]*)\) => \{\s*if \(\2\.exitCode !== null\) \{\s*\3\(\);\s*return;\s*\}\s*if \(process\.platform === "win32"\) \{\s*setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*), ([A-Za-z_$][A-Za-z0-9_$]*)\) => \{\s*if \(\4\.exitCode === null\) \4\.kill\("SIGKILL"\);\s*\5\(\);\s*\}, 5e3, \2, \3\)\.unref\(\);\s*return;\s*\}\s*\2\.kill\("SIGTERM"\), setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*)\) => \{\s*if \(\6\.exitCode === null\) \6\.kill\("SIGKILL"\);\s*\}, 5e3, \2\)\.unref\(\), \3\(\);\s*\}, ([A-Za-z_$][A-Za-z0-9_$]*), \1, ([A-Za-z_$][A-Za-z0-9_$]*)\)\.unref\(\), \1\.once\("exit", (\(\) => (?:\{[^{}]*\}|[^;{}]+))\);/g,
    replacement: (
      _match,
      processVariable,
      _processParam,
      _completeParam,
      _winProcessParam,
      _winCompleteParam,
      _forceKillParam,
      timeoutVariable,
      completeCallback,
      exitHandler,
    ) =>
      `if (${processVariable} && !${processVariable}.killed && ${processVariable}.exitCode === null) {` +
      '\n      const processKillTimer = setTimeout((childProcess, onClose) => {' +
      '\n        if (childProcess.exitCode !== null) {' +
      '\n          onClose();' +
      '\n          return;' +
      '\n        }' +
      '\n        if (process.platform === "win32") {' +
      '\n          const windowsForceKillTimer = setTimeout((windowsProcess, windowsOnClose) => {' +
      '\n            if (windowsProcess.exitCode === null) windowsProcess.kill("SIGKILL");' +
      '\n            windowsOnClose();' +
      '\n          }, 5e3, childProcess, onClose);' +
      '\n          windowsForceKillTimer.unref?.();' +
      '\n          return;' +
      '\n        }' +
      '\n        childProcess.kill("SIGTERM");' +
      '\n        const forceKillTimer = setTimeout((forceKillProcess) => {' +
      '\n          if (forceKillProcess.exitCode === null) forceKillProcess.kill("SIGKILL");' +
      '\n        }, 5e3, childProcess);' +
      '\n        forceKillTimer.unref?.();' +
      '\n        onClose();' +
      `\n      }, ${timeoutVariable}, ${processVariable}, ${completeCallback});` +
      '\n      processKillTimer.unref?.();' +
      `\n      ${processVariable}.once("exit", ${exitHandler});` +
      '\n    }',
  },
  {
    name: 'claude-sdk-process-transport-close',
    pattern: /if \(\$ && !\$\.killed && \$\.exitCode === null\) setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*)\) => \{\s*if \(\1\.killed \|\| \1\.exitCode !== null\) return;\s*\1\.kill\("SIGTERM"\), setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*)\) => \{\s*if \(\2\.exitCode === null\) \2\.kill\("SIGKILL"\);\s*\}, 5e3, \1\)\.unref\(\);\s*\}, ([A-Za-z_$][A-Za-z0-9_$]*), \$\)\.unref\(\), \$\.once\("exit", (\(\) => (?:\{[^{}]*\}|[^;{}]+))\);/g,
    replacement:
      'if ($ && !$.killed && $.exitCode === null) {' +
      '\n      const processKillTimer = setTimeout((X) => {' +
      '\n        if (X.killed || X.exitCode !== null) return;' +
      '\n        X.kill("SIGTERM");' +
      '\n        const forceKillTimer = setTimeout((J) => {' +
      '\n          if (J.exitCode === null) J.kill("SIGKILL");' +
      '\n        }, 5e3, X);' +
      '\n        forceKillTimer.unref?.();' +
      '\n      }, $3, $);' +
      '\n      processKillTimer.unref?.();' +
      '\n      $.once("exit", $4);' +
      '\n    }',
  },
  {
    name: 'claude-sdk-process-transport-close-win32-minified',
    pattern: /if\(([A-Za-z_$][A-Za-z0-9_$]*)&&!\1\.killed&&\1\.exitCode===null\)setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{if\(\2\.exitCode!==null\)\{\3\(\);return\}if\(process\.platform==="win32"\)\{setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{\4\.exitCode===null&&\4\.kill\("SIGKILL"\),\5\(\)\},5e3,\2,\3\)\.unref\(\);return\}\2\.kill\("SIGTERM"\),setTimeout\(([A-Za-z_$][A-Za-z0-9_$]*)=>\{\6\.exitCode===null&&\6\.kill\("SIGKILL"\)\},5e3,\2\)\.unref\(\),\3\(\)\},([A-Za-z_$][A-Za-z0-9_$]*),\1,([A-Za-z_$][A-Za-z0-9_$]*)\)\.unref\(\),\1\.once\("exit",(\(\)=>[^;]+)\);/g,
    replacement: (
      _match,
      processVariable,
      _processParam,
      _completeParam,
      _winProcessParam,
      _winCompleteParam,
      _forceKillParam,
      timeoutVariable,
      completeCallback,
      exitHandler,
    ) =>
      `if(${processVariable}&&!${processVariable}.killed&&${processVariable}.exitCode===null){` +
      `const processKillTimer=setTimeout((childProcess,onClose)=>{` +
      `if(childProcess.exitCode!==null){onClose();return}` +
      `if(process.platform==="win32"){` +
      `const windowsForceKillTimer=setTimeout((windowsProcess,windowsOnClose)=>{` +
      `windowsProcess.exitCode===null&&windowsProcess.kill("SIGKILL");` +
      `windowsOnClose();` +
      `},5e3,childProcess,onClose);` +
      `windowsForceKillTimer.unref?.();` +
      `return` +
      `}` +
      `childProcess.kill("SIGTERM");` +
      `const forceKillTimer=setTimeout((forceKillProcess)=>{` +
      `forceKillProcess.exitCode===null&&forceKillProcess.kill("SIGKILL");` +
      `},5e3,childProcess);` +
      `forceKillTimer.unref?.();` +
      `onClose();` +
      `},${timeoutVariable},${processVariable},${completeCallback});` +
      `processKillTimer.unref?.();` +
      `${processVariable}.once("exit",${exitHandler});` +
      `}`,
  },
  {
    name: 'claude-sdk-process-transport-close-win32-minified-expression',
    pattern: /setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{if\(\1\.exitCode!==null\)\{\2\(\);return\}if\(process\.platform==="win32"\)\{setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{\3\.exitCode===null&&\3\.kill\("SIGKILL"\),\4\(\)\},5e3,\1,\2\)\.unref\(\);return\}\1\.kill\("SIGTERM"\),setTimeout\(([A-Za-z_$][A-Za-z0-9_$]*)=>\{\5\.exitCode===null&&\5\.kill\("SIGKILL"\)\},5e3,\1\)\.unref\(\),\2\(\)\},([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)\.unref\(\),\7\.once\("exit",(\(\)=>[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*\(\7\))\)/g,
    replacement: (
      _match,
      _processParam,
      _completeParam,
      _winProcessParam,
      _winCompleteParam,
      _forceKillParam,
      timeoutVariable,
      processVariable,
      completeCallback,
      exitHandler,
    ) =>
      `(()=>{` +
      `const processKillTimer=setTimeout((childProcess,onClose)=>{` +
      `if(childProcess.exitCode!==null){onClose();return}` +
      `if(process.platform==="win32"){` +
      `const windowsForceKillTimer=setTimeout((windowsProcess,windowsOnClose)=>{` +
      `windowsProcess.exitCode===null&&windowsProcess.kill("SIGKILL");` +
      `windowsOnClose();` +
      `},5e3,childProcess,onClose);` +
      `windowsForceKillTimer.unref?.();` +
      `return` +
      `}` +
      `childProcess.kill("SIGTERM");` +
      `const forceKillTimer=setTimeout((forceKillProcess)=>{` +
      `forceKillProcess.exitCode===null&&forceKillProcess.kill("SIGKILL");` +
      `},5e3,childProcess);` +
      `forceKillTimer.unref?.();` +
      `onClose();` +
      `},${timeoutVariable},${processVariable},${completeCallback});` +
      `processKillTimer.unref?.();` +
      `${processVariable}.once("exit",${exitHandler});` +
      `})()`,
  },
  {
    name: 'claude-sdk-process-transport-close-signal-code-minified-expression',
    pattern: /setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{if\(\1\.exitCode!==null\|\|\1\.signalCode!=null\)\{\2\(\);return\}if\(process\.platform==="win32"\)\{setTimeout\(\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)=>\{\3\.exitCode===null&&\3\.kill\("SIGKILL"\),\4\(\)\},5e3,\1,\2\)\.unref\(\);return\}\1\.kill\("SIGTERM"\),setTimeout\(([A-Za-z_$][A-Za-z0-9_$]*)=>\{\5\.exitCode===null&&\5\.kill\("SIGKILL"\)\},5e3,\1\)\.unref\(\),\2\(\)\},([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\)\.unref\(\),\7\.once\("exit",(\(\)=>[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*\(\7\))\)/g,
    replacement: (
      _match,
      _processParam,
      _completeParam,
      _winProcessParam,
      _winCompleteParam,
      _forceKillParam,
      timeoutVariable,
      processVariable,
      completeCallback,
      exitHandler,
    ) =>
      `(()=>{` +
      `const processKillTimer=setTimeout((childProcess,onClose)=>{` +
      `if(childProcess.exitCode!==null||childProcess.signalCode!=null){onClose();return}` +
      `if(process.platform==="win32"){` +
      `const windowsForceKillTimer=setTimeout((windowsProcess,windowsOnClose)=>{` +
      `windowsProcess.exitCode===null&&windowsProcess.kill("SIGKILL");` +
      `windowsOnClose();` +
      `},5e3,childProcess,onClose);` +
      `windowsForceKillTimer.unref?.();` +
      `return` +
      `}` +
      `childProcess.kill("SIGTERM");` +
      `const forceKillTimer=setTimeout((forceKillProcess)=>{` +
      `forceKillProcess.exitCode===null&&forceKillProcess.kill("SIGKILL");` +
      `},5e3,childProcess);` +
      `forceKillTimer.unref?.();` +
      `onClose();` +
      `},${timeoutVariable},${processVariable},${completeCallback});` +
      `processKillTimer.unref?.();` +
      `${processVariable}.once("exit",${exitHandler});` +
      `})()`,
  },
  {
    name: 'mcp-sdk-stdio-close-wait',
    pattern: /new Promise\(\((resolve\d+)\) => setTimeout\(\1, 2e3\)\.unref\(\)\)/g,
    replacement:
      'new Promise(($1) => {' +
      '\n        const closeTimeout = setTimeout($1, 2e3);' +
      '\n        closeTimeout.unref?.();' +
      '\n      })',
  },
  {
    name: 'mcp-sdk-stdio-close-wait-minified',
    pattern: /new Promise\(([A-Za-z_$][A-Za-z0-9_$]*)=>setTimeout\(\1,2e3\)\.unref\(\)\)/g,
    replacement:
      'new Promise(($1)=>{' +
      'const closeTimeout=setTimeout($1,2e3);' +
      'closeTimeout.unref?.();' +
      '})',
  },
];

const TIMER_CALL_PREFIXES = ['setTimeout(', 'setInterval('];

function patchRendererUnsafeUnrefSites(contents) {
  let nextContents = contents;
  const appliedPatches = [];

  for (const patch of UNSAFE_TIMER_UNREF_PATTERNS) {
    const matchCount = [...nextContents.matchAll(patch.pattern)].length;
    if (matchCount === 0) {
      continue;
    }
    nextContents = nextContents.replace(patch.pattern, patch.replacement);
    appliedPatches.push({ name: patch.name, count: matchCount });
  }

  return {
    contents: nextContents,
    appliedPatches,
  };
}

function findUnsafeTimerUnrefSites(contents) {
  const matches = [];

  let searchIndex = 0;
  while (searchIndex < contents.length) {
    const timerStart = findNextTimerCall(contents, searchIndex);
    if (!timerStart) {
      break;
    }

    const callEnd = findMatchingParen(contents, timerStart.openParenIndex);
    if (callEnd === -1) {
      searchIndex = timerStart.startIndex + timerStart.prefix.length;
      continue;
    }

    const unrefMatch = contents.slice(callEnd + 1).match(/^\s*\.unref\(\)/);
    if (unrefMatch) {
      const startIndex = timerStart.startIndex;
      const endIndex = callEnd + 1 + unrefMatch[0].length;
      const line = contents.slice(0, startIndex).split('\n').length;
      matches.push({
        line,
        snippet: contents.slice(startIndex, endIndex),
      });
      searchIndex = endIndex;
      continue;
    }

    searchIndex = callEnd + 1;
  }

  return matches;
}

function findNextTimerCall(contents, startIndex) {
  let nextMatch = null;

  for (const prefix of TIMER_CALL_PREFIXES) {
    const index = contents.indexOf(prefix, startIndex);
    if (index === -1) {
      continue;
    }
    if (!nextMatch || index < nextMatch.startIndex) {
      nextMatch = {
        prefix,
        startIndex: index,
        openParenIndex: index + prefix.length - 1,
      };
    }
  }

  return nextMatch;
}

function findMatchingParen(contents, openParenIndex) {
  let depth = 1;
  let quote = null;

  for (let index = openParenIndex + 1; index < contents.length; index += 1) {
    const char = contents[index];

    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

module.exports = {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
};
