/* eslint-disable */
/* eslint-enable comma-dangle, semi, eol-last, quotes, switch-colon-spacing, space-before-blocks, no-dupe-keys, ident, linebreak-style */

const path = require("node:path");
const { runloop } = require("node-runloop");
const { existsSync, promises } = require("node:fs");


class Lazy {
  constructor(executor) {
    this._executor = executor;
  }

  get didRun() {
    return !!this._value || !!this._error;
  }

  get value() {
    if(!this.didRun) {
      try {
        this._value = this._executor();
      } catch (err) {
        this._error = err;
      }
    }

    if(!this._error)
      return this._value;

    throw this._error;
  }

  get rawValue() {
    return this._value;
  }
}

function arr(arg) {
  return Array.isArray(arg) ? arg : [arg];
}

function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }


class Obfuscation {
  static _parser = new Lazy(() => _interopRequireDefault(require("@babel/parser")));
  static _traverse = new Lazy(() => _interopRequireDefault(require("@babel/traverse")).default);
  static _generator = new Lazy(() => _interopRequireDefault(require("@babel/generator")).default);
  static _types = new Lazy(() => _interopRequireDefault(require("@babel/types")));

  static XOR_KEY = 42;

  /** @type {Buffer} */
  #buffer;

  constructor(buf) {
    this.#buffer = buf;
  }

  _xor(str) {
    return String(str)
      .split("")
      .map(char => String.fromCharCode(char.charCodeAt(0) ^ Obfuscation.XOR_KEY))
      .join("");
  }

  _encode(str) {
    const encoded = this._xor(str);
    return `(() => '${encoded}'.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ ${Obfuscation.XOR_KEY})).join(''))()`;
  }

  _dead() {
    const t = Obfuscation._types.value;

    const randomName = `_dead${Math.random().toString(36).slice(2, 8)}`;
    const deadVar = t.variableDeclaration("var", [
      t.variableDeclarator(t.identifier(randomName), t.numericLiteral(Math.random() * 100)),
    ]);

    const deadIf = t.ifStatement(
      t.booleanLiteral(false),
      t.blockStatement([
        t.expressionStatement(t.callExpression(t.identifier("console.log"), [t.stringLiteral("dead code")])),
      ]),
    );
    
    return Math.random() > 0.5 ? deadVar : deadIf;
  }

  _flattencf(fp) {
    const bodyStatements = fp.node.body.body;
    if(!bodyStatements.length) return;

    const t = Obfuscation._types.value;

    const stateId = fp.scope.generateUidIdentifier("state");
    const cases = [];
    const statesMap = new Map();

    bodyStatements.forEach((stmt, i) => {
      statesMap.set(stmt, i);
    });

    // Build switch cases from original statements
    bodyStatements.forEach((stmt, i) => {
      const nextState = i + 1;
      let statements = [];

      statements.push(stmt);

      if(nextState < bodyStatements.length) {
        statements.push(
          t.expressionStatement(t.assignmentExpression("=", stateId, t.numericLiteral(nextState))),
          t.breakStatement(),
        );
      } else {
        statements.push(t.breakStatement());
      }

      cases.push(t.switchCase(t.numericLiteral(i), statements));
    });

    const newBody = t.blockStatement([
      t.variableDeclaration("var", [t.variableDeclarator(stateId, t.numericLiteral(0))]),
      t.whileStatement(
        t.booleanLiteral(true),
        t.blockStatement([
          t.switchStatement(stateId, cases),
          t.breakStatement(),
        ]),
      ),
    ]);

    fp.get("body").replaceWith(newBody);
  }

  _idast(ast) {
    const traverse = Obfuscation._traverse.value;

    traverse(ast, {
      BlockStatement: (path) => {
        if(Math.random() < 0.3) {
          const deadStmt = this._dead();
          path.node.body.splice(Math.floor(Math.random() * path.node.body.length), 0, deadStmt);
        }
      },
    });
  }

  run() {
    const parser = Obfuscation._parser.value;

    const ast = parser.parse(this.#buffer, {
      sourceType: "module",
    });

    this._idast(ast);
    const traverse = Obfuscation._traverse.value;

    traverse(ast, {
      StringLiteral: (path) => {
        path.replaceWith(parser.parseExpression(this._encode(path.node.value)));
      },
      Identifier: (path) => {
        if (
          path.scope.hasBinding(path.node.name) &&
          !path.node.name.startsWith("__") &&
          !path.node.name.startsWith("_dead")
        ) {
          const obfuscatedName = `_${Math.random().toString(36).slice(2, 10)}`;
          path.scope.rename(path.node.name, obfuscatedName);
        }
      },
      FunctionDeclaration: (path) => {
        this._flattencf(path);
      },
      FunctionExpression: (path) => {
        this._flattencf(path);
      },
      ArrowFunctionExpression: (path) => {
        if (Obfuscation._types.value.isBlockStatement(path.node.body)) {
          this._flattencf(path);
        }
      },
    });

    const { code } = Obfuscation._generator.value(ast, {
      compact: true,
      comments: false,
    });

    return code;
  }
}


async function main() {
  console.log("[LOG] post build script started at " + Date.now());

  const BUILD_DIR = path.join(process.cwd(), process.env.OUTPUT_DIR ?? "dist");
  console.log(`[LOG] build dir match ${BUILD_DIR}`);

  if(!existsSync(BUILD_DIR)) {
    throw new Error("Output path does not exists");
  }

  const buildStat = await promises.stat(BUILD_DIR);

  if(!buildStat.isDirectory()) {
    throw new Error("Output path is not a directory");
  }

  
  if(process.env.NODE_ENV === "production") {
    await runloop.createTask(() => {
      console.log("[LOG] deleting useless content...");
      
      return rimraf(BUILD_DIR, {
        rule: "endsWith",
        value: [".spec.js", ".spec.d.ts", "test.js", "test.d.ts"],
      }, false);
    })
    .wait();

    console.log("[LOG] done.");

    if(!process.env.AVOID_OBFUSCATION) {
      console.log("[LOG] Obfuscating code...");

      const init = async (pathname) => {
        const contents = await promises.readdir(pathname);

        for(let i = 0; i < contents.length; i++) {
          const current = path.join(pathname, contents[i]);
          const cstat = await promises.stat(current);

          if(cstat.isDirectory()) {
            await init(current);
            continue;
          }

          if(contents[i].endsWith(".js")) {
            console.log(`[LOG] processing '${current}'...`);

            const buffer = await promises.readFile(current);
            await promises.rename(current, `${current}.tmp`);

            try {
              const output = new Obfuscation(buffer).run();
              await promises.writeFile(current, output);

              console.log("[LOG] done.");
            } catch (err) {
              console.log(`[LOG] failed due to: ${err.message || String(err)}`);

              try {
                await promises.unlink(current);
              } catch { }

              await promises.rename(`${current}.tmp`, current);
            }
          }
        }
      };

      await init(BUILD_DIR);
      console.log("[LOG] done.");
    }
  }
  
  console.log("[LOG] updating dependencies list...");

  const sourcePkg = JSON.parse(await promises.readFile(path.join(process.cwd(), "package.json")));
  const buildPkg = JSON.parse(await promises.readFile(path.join(process.cwd(), "package.build.json")));

  buildPkg["dependencies"] = sourcePkg["dependencies"];

  await promises.writeFile(
    path.join(process.cwd(), "package.build.json"),
    JSON.stringify(buildPkg, null, 2).trim() // eslint-disable-line comma-dangle
  );

  console.log("[LOG] done.");
}


async function rimraf(sourcePath, pattern = null, deleteBase = true) {
  const stat = await promises.stat(sourcePath);

  if(!stat.isDirectory()) {
    await promises.unlink(sourcePath);
    return;
  }

  const contents = await promises.readdir(sourcePath);

  for(const filename of contents) {
    const current = path.join(sourcePath, filename);

    if(pattern?.rule === "endsWith" && !arr(pattern.value).some(item => current.endsWith(item)))
      continue;

    const currStat = await promises.stat(current);

    if(currStat.isDirectory()) {
      await rimraf(current);
    } else {
      await promises.unlink(current);
    }
  }

  if(deleteBase) {
    await promises.rmdir(sourcePath);
  }
}


runloop.run(main);
