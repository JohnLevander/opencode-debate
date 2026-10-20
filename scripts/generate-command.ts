import { writeFile } from "node:fs/promises";
import { COMMAND_BODY, COMMAND_DESCRIPTION } from "../src/prompts.ts";
await writeFile(new URL("../commands/debate.md", import.meta.url), `---\ndescription: ${COMMAND_DESCRIPTION}\n---\n\n${COMMAND_BODY}\n`, "utf8");
