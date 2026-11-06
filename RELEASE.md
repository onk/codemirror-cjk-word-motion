# Release

1. Bump `version` in `package.json`, date the `## Unreleased` heading in `CHANGELOG.md`, and merge it into main.
2. Run the Publish workflow on main. It publishes to npm and pushes the tag `v<version>`.

If the workflow fails after publishing, push the tag `v<version>` yourself.
