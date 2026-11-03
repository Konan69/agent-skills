import { pathToFileURL } from "node:url";

export const DEFAULT_MODEL = process.env.PI_MODEL || "openrouter/z-ai/glm-5.3-flash";
export const APPROVED_MODELS = new Set(process.env.PI_APPROVED_MODELS?.split(",").map((model) => model.trim()).filter(Boolean) ?? [
  "openrouter/z-ai/glm-5.3-flash",
  "opencode/deepseek-v4-pro",
  "opencode/deepseek-v4-flash",
  "opencode/kimi-k3",
  "opencode/qwen3.8-max",
]);

export function assertApprovedModel(model) {
  if (!APPROVED_MODELS.has(model)) {
    throw new Error(`model ${model} is not approved for pi; use an exact ID from PI_APPROVED_MODELS or the defaults in model-policy.mjs.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--scope") {
    console.log(JSON.stringify({ subagents: { modelScope: { enforce: true, allow: [...APPROVED_MODELS] } } }, null, 2));
  } else {
    try {
      assertApprovedModel(process.argv[2] === "--check" ? process.argv[3] : process.argv[2] || DEFAULT_MODEL);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
