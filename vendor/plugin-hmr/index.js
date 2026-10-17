var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// <cordis-src>/index.ts
import { Inject, Service } from "cordis";
import { watch } from "chokidar";
import { relative, resolve } from "node:path";

// <cordis-src>/error.ts
import { codeFrameColumns } from "@babel/code-frame";
import { readFileSync } from "node:fs";
function isBuildFailure(e) {
  return Array.isArray(e?.errors) && e.errors.every((error) => error.text);
}
function handleError(ctx, e) {
  if (!isBuildFailure(e)) {
    ctx.logger.warn(e);
    return;
  }
  for (const error of e.errors) {
    if (!error.location) {
      ctx.logger.warn(error.text);
      continue;
    }
    try {
      const { file, line, column } = error.location;
      const source = readFileSync(file, "utf8");
      const formatted = codeFrameColumns(source, {
        start: { line, column }
      }, {
        highlightCode: true,
        message: error.text
      });
      ctx.logger.warn(`File: ${file}:${line}:${column}
` + formatted);
    } catch (e2) {
      ctx.logger.warn(e2);
    }
  }
}

// <cordis-src>/index.ts
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import picomatch from "picomatch";

// <cordis-src>/locales/en-US.yml
var en_US_default = { "base": "The root directory of the displayed path, defaults to the current working directory.", "root": "List of files or directories to listen to, relative to the `base` path.", "ignored": "Files or directories to ignore. Supports [Glob Patterns](https://github.com/micromatch/micromatch) syntax.", "debounce": "Debounce updates in milliseconds." };

// <cordis-src>/locales/zh-CN.yml
var zh_CN_default = { "base": "\u7528\u6237\u663E\u793A\u8DEF\u5F84\u7684\u6839\u76EE\u5F55\uFF0C\u9ED8\u8BA4\u4E3A\u5F53\u524D\u5DE5\u4F5C\u8DEF\u5F84\u3002", "root": "\u8981\u76D1\u542C\u7684\u6587\u4EF6\u6216\u76EE\u5F55\u5217\u8868\uFF0C\u76F8\u5BF9\u4E8E `base` \u8DEF\u5F84\u3002", "ignored": "\u8981\u5FFD\u7565\u7684\u6587\u4EF6\u6216\u76EE\u5F55\u3002\u652F\u6301 [Glob Patterns](https://github.com/micromatch/micromatch) \u8BED\u6CD5\u3002", "debounce": "\u5EF6\u8FDF\u89E6\u53D1\u66F4\u65B0\u7684\u7B49\u5F85\u65F6\u95F4\u3002" };

// <cordis-src>/index.ts
import z from "schemastery";
async function loadDependencies(job, ignored = /* @__PURE__ */ new Set()) {
  const dependencies = /* @__PURE__ */ new Set();
  async function traverse(job2) {
    if (ignored.has(job2.url) || dependencies.has(job2.url)) return;
    if (job2.url.startsWith("node:") || job2.url.includes("/node_modules/")) return;
    dependencies.add(job2.url);
    const children = await job2.linked;
    await Promise.all(Array.prototype.map.call(children, traverse));
  }
  await traverse(job);
  return dependencies;
}
var _Hmr_decorators, _init, _a;
_Hmr_decorators = [Inject("loader"), Inject("timer")];
var Hmr = class extends (_a = Service) {
  constructor(ctx, config) {
    super(ctx, "hmr");
    this.config = config;
    if (!this.ctx.loader.internal) {
      throw new Error("--expose-internals is required for HMR service");
    }
    this.internal = this.ctx.loader.internal;
    this.baseDir = fileURLToPath(new URL(config.base || ".", ctx.baseUrl));
  }
  config;
  baseDir;
  internal;
  watcher;
  /**
   * Changes from externals will always trigger a full reload.
   * Externals are the dependency tree of the CLI worker entry point.
   */
  externals;
  /**
   * Files that should be reloaded (accepted changes).
   * Includes all stashed files and their dependents.
   */
  accepted;
  /**
   * Files that should NOT be reloaded.
   * Includes externals and files whose dependents are all declined.
   */
  declined;
  /** Stashed file changes waiting to be processed */
  stashed = /* @__PURE__ */ new Set();
  /**
   * Resolve a module specifier to a URL, compatible with Node 22-24.
   */
  async _resolve(specifier, parentURL, attrs) {
    switch (this.internal.version) {
      case "v1":
        return await this.internal.resolve(specifier, parentURL, attrs);
      case "v2":
        return this.internal.resolveSync(parentURL, { specifier, attributes: attrs });
    }
  }
  async *[Service.init]() {
    yield () => this.watcher?.close();
    const { loader } = this.ctx;
    const { root, ignored } = this.config;
    if (!this.config.base) {
      this.ctx.logger.info("watching %o", root);
    } else {
      this.ctx.logger.info("watching %o in %s", root, this.baseDir);
    }
    const match = picomatch(ignored);
    this.watcher = watch(root, {
      ...this.config,
      cwd: this.baseDir,
      ignored: (path) => match(relative(this.baseDir, path))
    });
    const mainUrl = pathToFileURL(resolve(process.argv[1])).href;
    const mainJob = this.internal.loadCache.get(mainUrl);
    if (mainJob) {
      this.externals = await loadDependencies(mainJob);
    } else {
      this.externals = /* @__PURE__ */ new Set();
    }
    const partialReload = this.ctx.debounce(() => this.partialReload(), this.config.debounce);
    this.watcher.on("change", async (path) => {
      this.ctx.logger.debug("change detected at %C", path);
      const filename = resolve(this.baseDir, path);
      const url = pathToFileURL(filename).href;
      if (this.externals.has(url)) return loader.exit();
      if (loader.internal.loadCache.has(url)) {
        this.stashed.add(url);
        return partialReload();
      }
      for (const entry of this.ctx.loader.entries()) {
        const include = entry.subtree;
        if (include?.filename !== filename) continue;
        await include.refresh();
        return;
      }
      this.ctx.emit("hmr/change", url);
    });
  }
  // hide stack trace from HMR
  getOuterStack = () => [
    // '    at HMR.partialReload (<anonymous>)',
  ];
  async getLinked(url) {
    const job = this.internal.loadCache.get(url);
    if (!job) return [];
    const linked = await job.linked;
    return Array.prototype.map.call(linked, (job2) => job2.url);
  }
  /**
   * Classify changed files into accepted (should reload) and declined (should not).
   *
   * A file is accepted if it's directly changed (stashed) or if any of its
   * dependents are accepted. A file is declined if all its dependents are
   * declined or if it's an external.
   */
  async analyzeChanges() {
    const pending = [];
    this.accepted = new Set(this.stashed);
    this.declined = new Set(this.externals);
    const isExcluded = (url) => url.startsWith("node:") || url.includes("/node_modules/");
    await Promise.all([...this.stashed].map(async (url) => {
      const children = await this.getLinked(url);
      for (const child of children) {
        if (this.accepted.has(child) || this.declined.has(child) || isExcluded(child)) continue;
        pending.push(child);
      }
    }));
    while (pending.length) {
      let index = 0, hasUpdate = false;
      while (index < pending.length) {
        const url = pending[index];
        const children = await this.getLinked(url);
        let isDeclined = true, isAccepted = false;
        for (const child of children) {
          if (this.declined.has(child) || isExcluded(child)) continue;
          if (this.accepted.has(child)) {
            isAccepted = true;
            break;
          } else {
            isDeclined = false;
            if (!pending.includes(child)) {
              hasUpdate = true;
              pending.push(child);
            }
          }
        }
        if (isAccepted || isDeclined) {
          hasUpdate = true;
          pending.splice(index, 1);
          if (isAccepted) {
            this.accepted.add(url);
          } else {
            this.declined.add(url);
          }
        } else {
          index++;
        }
      }
      if (!hasUpdate) break;
    }
    for (const url of pending) {
      this.declined.add(url);
    }
  }
  async partialReload() {
    await this.analyzeChanges();
    const pending = /* @__PURE__ */ new Map();
    const reloads = /* @__PURE__ */ new Map();
    const nameMap = /* @__PURE__ */ Object.create(null);
    for (const entry of this.ctx.loader.entries()) {
      (nameMap[entry.parent.tree.ctx.baseUrl] ??= /* @__PURE__ */ new Set()).add(entry.options.name);
    }
    for (const baseUrl in nameMap) {
      for (const name of nameMap[baseUrl]) {
        try {
          const { url } = await this._resolve(name, baseUrl, {});
          if (this.declined.has(url)) continue;
          const job = this.internal.loadCache.get(url);
          const plugin = this.ctx.loader.unwrapExports(job?.module?.getNamespace());
          if (!job || !plugin) continue;
          pending.set(job, plugin);
          this.declined.add(url);
        } catch (err) {
          this.ctx.logger.warn(err);
        }
      }
    }
    for (const [job, plugin] of pending) {
      this.declined.delete(job.url);
      const dependencies = [...await loadDependencies(job, this.declined)];
      this.declined.add(job.url);
      if (!dependencies.some((dep) => this.accepted.has(dep))) continue;
      dependencies.forEach((dep) => this.accepted.add(dep));
      reloads.set(plugin, {
        filename: job.url,
        runtime: this.ctx.registry.get(plugin)
      });
    }
    const esmBackup = /* @__PURE__ */ Object.create(null);
    const cjsBackup = /* @__PURE__ */ Object.create(null);
    const require2 = createRequire(import.meta.url);
    for (const filename of this.accepted) {
      const job = Map.prototype.get.call(this.internal.loadCache, filename);
      esmBackup[filename] = job;
      Map.prototype.delete.call(this.internal.loadCache, filename);
      try {
        const filepath = fileURLToPath(filename);
        if (require2.cache[filepath]) {
          cjsBackup[filepath] = require2.cache[filepath];
          delete require2.cache[filepath];
        }
      } catch {
      }
    }
    const rollback = () => {
      for (const filename in esmBackup) {
        Map.prototype.set.call(this.internal.loadCache, filename, esmBackup[filename]);
      }
      for (const filepath in cjsBackup) {
        require2.cache[filepath] = cjsBackup[filepath];
      }
    };
    const attempts = {};
    try {
      for (const [, { filename }] of reloads) {
        attempts[filename] = this.ctx.loader.unwrapExports(await this.ctx.loader.import(filename, this.getOuterStack));
      }
    } catch (e) {
      handleError(this.ctx, e);
      return rollback();
    }
    const reload = (plugin, runtime) => {
      if (!runtime) return;
      for (const oldFiber of runtime.fibers) {
        const fiber = oldFiber.parent.registry.plugin(plugin, oldFiber.config, this.getOuterStack);
        fiber.entry = oldFiber.entry;
        if (fiber.entry) fiber.entry.fiber = fiber;
      }
    };
    try {
      for (const [plugin, { filename, runtime }] of reloads) {
        if (!runtime) continue;
        const path = relative(this.baseDir, fileURLToPath(filename));
        try {
          this.ctx.registry.delete(plugin);
        } catch (err) {
          this.ctx.logger.warn("failed to dispose plugin at %C", path);
          this.ctx.logger.warn(err);
        }
        try {
          reload(attempts[filename], runtime);
          this.ctx.logger.info("reload plugin at %C", path);
        } catch (err) {
          this.ctx.logger.warn("failed to reload plugin at %C", path);
          this.ctx.logger.warn(err);
          throw err;
        }
      }
    } catch {
      rollback();
      for (const [plugin, { filename, runtime }] of reloads) {
        if (!runtime) continue;
        try {
          this.ctx.registry.delete(attempts[filename]);
          reload(plugin, runtime);
        } catch (err) {
          this.ctx.logger.warn(err);
        }
      }
      return;
    }
    this.ctx.emit("hmr/reload", reloads);
    this.stashed = /* @__PURE__ */ new Set();
  }
};
_init = __decoratorStart(_a);
Hmr = __decorateElement(_init, 0, "Hmr", _Hmr_decorators, Hmr);
__runInitializers(_init, 1, Hmr);
((Hmr2) => {
  Hmr2.Config = z.object({
    base: z.string(),
    root: z.array(String).role("table").default(["."]),
    ignored: z.array(String).role("table").default([
      "**/node_modules",
      "**/.*",
      "cache",
      "data"
    ]),
    debounce: z.natural().role("ms").default(100)
  }).i18n({
    "en-US": en_US_default,
    "zh-CN": zh_CN_default
  });
})(Hmr || (Hmr = {}));
var index_default = Hmr;
export {
  index_default as default
};
