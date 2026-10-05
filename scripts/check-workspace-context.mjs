import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/workspace-context.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const env = {};
const context = vm.createContext({});
const module = new vm.SourceTextModule(outputText, { context });
const binding = new vm.SyntheticModule(["env"], function () { this.setExport("env", env); }, { context });
await module.link((specifier) => {
  // No request headers, cookies or authentication modules may be dependencies.
  assert.equal(specifier, "cloudflare:workers");
  return binding;
});
await module.evaluate();
const workspace = module.namespace;
await assert.rejects(workspace.currentWorkspaceId(), workspace.WorkspaceConfigurationError);
env.PROJECT_OS_WORKSPACE_ID = " shared-workspace ";
assert.equal(await workspace.currentWorkspaceId(), "shared-workspace");
assert.equal(await workspace.canClaimLegacyWorkspace("shared-workspace"), true);
assert.equal(await workspace.canClaimLegacyWorkspace("other-visitor"), false);
for (const value of ["", "../other", "bad?query", "x".repeat(201)]) {
  env.PROJECT_OS_WORKSPACE_ID = value;
  await assert.rejects(workspace.currentWorkspaceId(), workspace.WorkspaceConfigurationError);
}
console.log("Anonymous workspace checks passed: server-only selection, no authentication dependency, invalid configuration rejected.");
