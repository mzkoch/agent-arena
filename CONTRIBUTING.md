# Contributing to Agent Arena

## Development Setup

```bash
git clone https://github.com/mzkoch/agent-arena.git
cd agent-arena
npm install
```

## Validation

Run the full validation suite before submitting changes:

```bash
npm run validate
```

This runs lint → typecheck → build → test with coverage in sequence. The test suite enforces a minimum 80% coverage threshold on business-logic code.

Individual commands:

```bash
npm run lint           # ESLint (zero warnings allowed)
npm run typecheck      # tsc --noEmit
npm run build          # tsup
npm run test           # vitest
npm run test:coverage  # vitest with coverage report
```

## Submitting Changes

1. Fork the repository.
2. Create a feature branch from `main`.
3. Run `npm run validate` and ensure it passes.
4. Open a pull request with a focused change set.

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **Patch** (`0.1.x`): Bug fixes, documentation updates
- **Minor** (`0.x.0`): New features, non-breaking changes
- **Major** (`x.0.0`): Breaking API or CLI changes

The project is pre-1.0 — the CLI interface may change between minor versions.

## Release Process

Releases are fully automated via GitHub Actions. Pushing a version tag triggers the release workflow which validates, publishes to npm, builds platform binaries, and creates a GitHub Release.

### Steps

1. **Bump the version:**

   ```bash
   npm version patch   # or minor, major
   ```

   This updates `package.json`, `package-lock.json`, and creates a git tag.

2. **Push the commit and tag:**

   ```bash
   git push && git push --tags
   ```

3. **Create the GitHub Release:**

   ```bash
   gh release create v<version> --target main \
     --title "v<version> — <title>" \
     --generate-notes
   ```

   The tag push triggers the [release workflow](.github/workflows/release.yml) which:
   - Runs the full validation suite
   - Publishes `@mzkoch/agent-arena` to npm (via OIDC trusted publishing)
   - Builds standalone binaries for 5 platforms (Linux/macOS amd64+arm64, Windows amd64)
   - Attaches binary artifacts to the GitHub Release

### npm Authentication

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) with OIDC — no tokens or secrets are needed. Authentication is handled automatically by GitHub Actions exchanging an OIDC token with the npm registry.

The trusted publisher is configured on npmjs.com for the `release.yml` workflow in `mzkoch/agent-arena`.

### Distribution Channels

| Channel | Package | Install command |
|---------|---------|-----------------|
| npm | `@mzkoch/agent-arena` | `npm install -g @mzkoch/agent-arena` |
| GitHub Release | Platform binaries | See [install scripts](scripts/) |
| Homebrew | `Formula/arena.rb` | `brew tap mzkoch/tools && brew install arena` |

### Hotfix Releases

For urgent fixes on the latest release:

1. Fix the issue on `main`.
2. Run `npm version patch` to bump the patch version.
3. Push and create the release as above.
