import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultConfig } from "expo/metro-config.js";

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(clientRoot);
const sharedPackagesRoot = `${path.resolve(clientRoot, "../../packages")}${path.sep}`;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSharedTypeScriptEsmImport =
    context.originModulePath.startsWith(sharedPackagesRoot) &&
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js");

  if (isSharedTypeScriptEsmImport) {
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
