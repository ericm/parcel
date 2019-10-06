// @flow
import type {FilePath, ModuleSpecifier} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {PackageManager, PackageInstaller, InstallOptions} from './types';
import type {ResolveResult} from '@parcel/utils';

import {installPackage} from './installPackage';
import {dirname} from 'path';
import {
  registerSerializableClass,
  resolve,
  resolveSync,
  NodeResolver,
  NodeResolverSync
} from '@parcel/utils';
import pkg from '../package.json';
// $FlowFixMe
import Module from 'module';
import path from 'path';
import nativeFS from 'fs';

// This implements a package manager for Node by monkey patching the Node require
// algorithm so that it uses the specified FileSystem instead of the native one.
// It also handles installing packages when they are required if not already installed.
// See https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js
// for reference to Node internals.
export class NodePackageManager implements PackageManager {
  fs: FileSystem;
  installer: ?PackageInstaller;
  cache: Map<ModuleSpecifier, ResolveResult> = new Map();
  promiseCache: Map<ModuleSpecifier, Promise<ResolveResult>> = new Map();

  constructor(fs: FileSystem, installer?: ?PackageInstaller) {
    this.fs = fs;
    this.installer = installer;
    this.resolver = new NodeResolver(fs);
    this.syncResolver = new NodeResolverSync(fs);
    this.realpathCache = new Map();
  }

  static deserialize(opts: any) {
    return new NodePackageManager(opts.fs, opts.installer);
  }

  serialize() {
    return {
      $$raw: false,
      fs: this.fs,
      installer: this.installer
    };
  }

  async require(name: ModuleSpecifier, from: FilePath) {
    let {resolved} = await this.resolve(name, from);
    return this.load(resolved, from);
  }

  requireSync(name: ModuleSpecifier, from: FilePath) {
    let {resolved} = this.resolveSync(name, from);
    return this.load(resolved, from);
  }

  realpathSync(filePath: FilePath) {
    if (this.realpathCache.has(filePath)) {
      return this.realpathCache.get(filePath);
    }

    let realpath = this.fs.realpathSync(filePath);
    this.realpathCache.set(filePath, realpath);
    return realpath;
  }

  load(resolved: FilePath, from: FilePath) {
    if (!path.isAbsolute(resolved)) {
      // Node builtin module
      // $FlowFixMe
      return require(resolved);
    }

    let filePath = this.realpathSync(resolved);
    const cachedModule = Module._cache[filePath];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }

    let m = new Module(filePath, Module._cache[from] || module.parent);
    Module._cache[filePath] = m;

    // Patch require within this module so it goes through our require
    m.require = id => {
      return this.requireSync(id, filePath);
    };

    // Patch `fs.readFileSync` temporarily so that it goes through our file system
    let readFileSync = nativeFS.readFileSync;
    // $FlowFixMe
    nativeFS.readFileSync = (filename, encoding) => {
      // $FlowFixMe
      nativeFS.readFileSync = readFileSync;
      return this.fs.readFileSync(filename, encoding);
    };

    try {
      m.load(filePath);
    } catch (err) {
      delete Module._cache[filePath];
      throw err;
    }

    return m.exports;
  }

  resolve(
    name: ModuleSpecifier,
    from: FilePath,
    triedInstall: boolean = false
  ) {
    let basedir = dirname(from);
    let key = basedir + ':' + name;
    if (this.promiseCache.has(key)) {
      return this.promiseCache.get(key);
    }

    let promise = this._resolve(name, from, triedInstall);
    this.promiseCache.set(key, promise);
    return promise;
  }

  async _resolve(
    name: ModuleSpecifier,
    from: FilePath,
    triedInstall: boolean = false
  ) {
    let basedir = dirname(from);
    let key = basedir + ':' + name;
    let resolved = this.cache.get(key);
    if (!resolved) {
      try {
        resolved = await this.resolver.resolve(name, {
          basedir,
          extensions: Object.keys(Module._extensions)
        });
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
          await this.install([name], from);
          return this.resolve(name, from, true);
        }
        throw e;
      }
      this.cache.set(key, resolved);
    }

    return resolved;
  }

  resolveSync(name: ModuleSpecifier, from: FilePath) {
    let basedir = dirname(from);
    return this.syncResolver.resolve(name, {
      basedir,
      extensions: Object.keys(Module._extensions)
    });
  }

  async install(
    modules: Array<ModuleSpecifier>,
    from: FilePath,
    opts?: InstallOptions
  ) {
    console.log('INSTALL', modules);
    return;
    await installPackage(this.fs, modules, from, {
      packageInstaller: this.installer,
      ...opts
    });
  }
}

registerSerializableClass(
  `${pkg.version}:NodePackageManager`,
  NodePackageManager
);
