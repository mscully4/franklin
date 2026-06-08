import { rmSync, mkdirSync, cpSync, existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import log from "../logger.js";

const PLUGIN_DIR = "/tmp/franklin-integrations";

let assembledDir: string | null = null;

type IntegrationEntry = string | { name: string; description?: string; env?: string[]; skillLocation?: string };

function isUrl(loc: string): boolean {
  return /^https?:\/\//.test(loc);
}

/**
 * Assemble enabled integration skills into a Claude Code plugin at
 * /tmp/franklin-integrations/. Nukes any existing dir first.
 *
 * skillLocation can be:
 *   - A local relative path like "./skills/mmoney" (directory containing SKILL.md)
 *   - A URL like "https://raw.githubusercontent.com/.../SKILL.md" (fetched at startup)
 *
 * Returns the plugin dir path, or null if no integrations have skill files.
 */
export async function assembleIntegrationSkills(
  integrations: IntegrationEntry[],
  projectRoot: string,
): Promise<string | null> {
  const withSkills = integrations
    .filter((e): e is { name: string; skillLocation: string } & Record<string, unknown> =>
      typeof e !== "string" && typeof e.skillLocation === "string" && e.skillLocation.length > 0,
    );

  if (!withSkills.length) {
    log.debug("No integration skills to assemble");
    return null;
  }

  // Nuke and recreate
  if (existsSync(PLUGIN_DIR)) {
    rmSync(PLUGIN_DIR, { recursive: true, force: true });
  }

  mkdirSync(join(PLUGIN_DIR, ".claude-plugin"), { recursive: true });
  mkdirSync(join(PLUGIN_DIR, "skills"), { recursive: true });

  // Write plugin manifest
  const manifest = {
    name: "franklin-integrations",
    version: "1.0.0",
    description: "Franklin integration skills — auto-assembled at startup from settings.json",
  };
  writeFileSync(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), JSON.stringify(manifest, null, 2));

  let count = 0;
  for (const entry of withSkills) {
    const destDir = join(PLUGIN_DIR, "skills", entry.name);

    if (isUrl(entry.skillLocation)) {
      // URL — fetch the raw SKILL.md
      try {
        log.info(` Fetching skill for "${entry.name}" from ${entry.skillLocation}`);
        const res = await fetch(entry.skillLocation);
        if (!res.ok) {
          log.warn(`Integration "${entry.name}" fetch failed: HTTP ${res.status}`);
          continue;
        }
        const content = await res.text();
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, "SKILL.md"), content);
        log.info(` Assembled skill: ${entry.name} ← ${entry.skillLocation}`);
        count++;
      } catch (err) {
        log.warn(`Integration "${entry.name}" fetch error: ${(err as Error).message}`);
      }
    } else {
      // Local path
      const src = resolve(projectRoot, entry.skillLocation);
      if (!existsSync(src)) {
        log.warn(`Integration "${entry.name}" skill path not found: ${src}`);
        continue;
      }
      cpSync(src, destDir, { recursive: true });
      log.info(` Assembled skill: ${entry.name} → ${destDir}`);
      count++;
    }
  }

  log.info(`Assembled ${count} integration skill(s) into ${PLUGIN_DIR}`);
  assembledDir = PLUGIN_DIR;
  return PLUGIN_DIR;
}

/** Returns the assembled plugin dir path, or null if no skills were assembled. */
export function getPluginDir(): string | null {
  return assembledDir;
}
