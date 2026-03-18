import type { CompletionProtocol, VariantConfig } from '../domain/types';

const deliverableChecklist = [
  'Complete implementation of all requirements',
  'Automated tests for core functionality',
  'README with setup and usage instructions',
  'All dependencies declared'
];

export const buildArenaInstructions = (
  variant: VariantConfig,
  protocol: CompletionProtocol
): string => `# Arena Instructions

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
\`${protocol.doneMarker}\`

If still working, output:
\`${protocol.continueMarker}\`
`;

export const buildLaunchPrompt = (): string =>
  'Read .arena/REQUIREMENTS.md and .arena/ARENA-INSTRUCTIONS.md in your working directory, then follow the instructions to build the complete solution. Begin now.';

export const buildStatusCheckPrompt = (protocol: CompletionProtocol): string =>
  `Status check: if you have completed every deliverable, reply with ${protocol.doneMarker}. Otherwise reply with ${protocol.continueMarker}.`;
