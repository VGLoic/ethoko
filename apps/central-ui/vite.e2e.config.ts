import { mergeConfig } from "vite";
import appConfig from "./vite.config.ts";

// Prebundle the route dependency before the first browser fills a form, rather
// than allowing Vite's first-use optimizer to reload it mid-interaction.
export default mergeConfig(appConfig, { optimizeDeps: { include: ["zod"] } });
