import fs from 'node:fs/promises';
import path from 'node:path';
import type { Variant } from '../config/types.js';
import type { CompletionProtocol } from '../providers/types.js';

/**
 * Write requirements and instructions files into a worktree directory.
 */
export async function writePromptFiles(
  worktreePath: string,
  requirements: string,
  variant: Variant,
  completionProtocol: CompletionProtocol,
): Promise<void> {
  // Copy requirements
  await fs.writeFile(
    path.join(worktreePath, 'REQUIREMENTS.md'),
    requirements,
    'utf-8',
  );

  // Generate instructions
  const instructions = buildInstructions(variant, completionProtocol);
  await fs.writeFile(
    path.join(worktreePath, 'ARENA-INSTRUCTIONS.md'),
    instructions,
    'utf-8',
  );
}

/**
 * Build the ARENA-INSTRUCTIONS.md content for a variant.
 */
function buildInstructions(
  variant: Variant,
  protocol: CompletionProtocol,
): string {
  return `# Arena Instructions

## Your Design Assignment

You are one of several AI agents independently building a solution to the requirements in REQUIREMENTS.md.
Your implementation should be **complete, production-ready, and elegant**.

### Your Constraints

- **Tech Stack**: ${variant.techStack}
- **Design Philosophy**: ${variant.designPhilosophy}

### Deliverables

1. Design Document (DESIGN.md)
2. Complete Implementation
3. Automated Tests
4. Docker Support (Dockerfile and/or docker-compose.yml)
5. README.md with setup and usage instructions
6. All dependencies properly declared

### Guidelines

- Write clean, idiomatic code for your chosen tech stack
- Commit your work with meaningful commit messages as you go
- Include error handling and input validation
- Write tests that cover core functionality
- Ensure the project can be built and run from a clean checkout

### Completion Protocol

When you have finished all deliverables, output the marker:

\`${protocol.doneMarker}\`

If you are still working and need more time, output the marker:

\`${protocol.continueMarker}\`

You may be asked periodically if you have completed your work. Respond with one of these markers.

---

Begin by reading REQUIREMENTS.md carefully, then create your design document, and implement the full solution.
`;
}

/**
 * Build the short initial prompt string sent to the agent CLI.
 * This is the text passed via -i flag (Copilot), positional arg (Claude), or stdin.
 */
export function buildInitialPrompt(): string {
  return 'Read REQUIREMENTS.md and ARENA-INSTRUCTIONS.md in your working directory, then follow the instructions to build the complete solution. Begin now.';
}
