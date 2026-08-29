/**
 * Skills visible to the UI palette: frontmatter (name/description) parsed
 * from SKILL.md in the global agent dir plus the project's .omp/skills.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export async function listSkills(cwd) {
  const roots = [
    { dir: path.join(os.homedir(), ".omp", "agent", "skills"), source: "global" },
    { dir: path.join(cwd, ".omp", "skills"), source: "project" },
  ];
  const out = [];
  for (const { dir, source } of roots) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = { name: entry.name, description: "", source };
      try {
        const raw = await fsp.readFile(path.join(dir, entry.name, "SKILL.md"), "utf8");
        const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter) {
          const name = frontmatter[1].match(/^name:\s*(.+)$/m);
          const description = frontmatter[1].match(/^description:\s*(.+)$/m);
          if (name) meta.name = name[1].trim();
          if (description) meta.description = description[1].trim().slice(0, 120);
        }
      } catch {
        // SKILL.md missing — keep directory name
      }
      out.push(meta);
    }
  }
  return out;
}
