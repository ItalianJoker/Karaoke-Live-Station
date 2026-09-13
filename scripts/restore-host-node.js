#!/usr/bin/env node

/**
 * scripts/restore-host-node.js
 *
 * Restores the host Linux better_sqlite3.node native module after cross-platform packaging.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const targetNodePath = path.join(ROOT_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const hostCachedPath = path.join(ROOT_DIR, 'bin', '.cache', 'better-sqlite3', 'linux-x64', 'better_sqlite3.node');

if (fs.existsSync(hostCachedPath)) {
  fs.copyFileSync(hostCachedPath, targetNodePath);
  console.log('[restore-host-node] Restored Linux host better_sqlite3.node');
}

