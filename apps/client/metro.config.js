import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultConfig } from "expo/metro-config.js";

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(clientRoot);
const sharedPackagesRoot = `${path.resolve(clientRoot, "../../packages")}${path.sep}`;
const clientSourceRoot = `${path.resolve(clientRoot, "src")}${path.sep}`;
const clientEntry = path.resolve(clientRoot, "App.tsx");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isTypeScriptEsmImport =
    (context.originModulePath.startsWith(sharedPackagesRoot) ||
      context.originModulePath.startsWith(clientSourceRoot) ||
      context.originModulePath === clientEntry) &&
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js");

  if (isTypeScriptEsmImport) {
    try {
      return context.resolveRequest(
        context,
        moduleName.slice(0, -".js".length),
        platform
      );
    } catch {
      // Fall through so real JavaScript files and normal Metro diagnostics still work.
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

export default config;
