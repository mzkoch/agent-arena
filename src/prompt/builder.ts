import type { VariantConfig } from '../domain/types';
import { formatSignalEnvelope } from '../orchestrator/signal-protocol';

const deliverableChecklist = [
  'Complete implementation of all requirements',
  'Automated tests for core functionality',
  'README with setup and usage instructions',
  'All dependencies declared'
];

export const buildArenaInstructions = (
  variant: VariantConfig
): string => {
  const doneExample = formatSignalEnvelope({ status: 'done' });
  const continueExample = formatSignalEnvelope({ status: 'continue' });

  return `# Arena Instructions

## Your Design Assignment

You are one of several AI agents independently building a solution to the requirements in .arena/REQUIREMENTS.md.
Your implementation should be complete, production-ready, and elegant.

### Your Constraints

- Tech Stack: ${variant.techStack}
- Design Philosophy: ${variant.designPhilosophy}

### Deliverables

${deliverableChecklist.map((item, index) => `${index + 1}. ${item}`).join('\n')}

### Guidelines

- Write clean, idiomatic code for the chosen stack
- Include strong error handling and input validation
- Write tests for the core functionality
- Ensure the project builds from a clean checkout
- **Commit your work early and often** — uncommitted changes may be lost
- Push your branch to the remote when finished

### Completion Protocol

When complete, output:
\`${doneExample}\`

If still working, output:
\`${continueExample}\`

The orchestrator verifies your work before accepting completion and may send feedback if verification fails.
`;
};

export const buildLaunchPrompt = (): string =>
  'Read .arena/REQUIREMENTS.md and .arena/ARENA-INSTRUCTIONS.md in your working directory, then follow the instructions to build the complete solution. Begin now.';

export const buildStatusCheckPrompt = (): string => {
  const doneExample = formatSignalEnvelope({ status: 'done' });
  const continueExample = formatSignalEnvelope({ status: 'continue' });
  return `Status check: if you have completed every deliverable, reply with ${doneExample}. Otherwise reply with ${continueExample}.`;
};
