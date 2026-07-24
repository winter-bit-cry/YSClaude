const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Git metadata can change while Metro is enumerating directories (for example,
// Codex creates and removes temporary refs). Metro never needs these files, and
// excluding them prevents Windows' fallback watcher from racing those updates.
const gitMetadata = /[\\/].git[\\/].*/;
const existingBlockList = config.resolver.blockList;

config.resolver.blockList = existingBlockList
  ? Array.isArray(existingBlockList)
    ? [...existingBlockList, gitMetadata]
    : [existingBlockList, gitMetadata]
  : gitMetadata;

module.exports = config;
