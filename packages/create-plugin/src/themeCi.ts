/** Read-only validation for branches and untrusted pull requests. */
export function themeValidationWorkflow(): string {
  return `name: Validate theme
on:
  push:
    branches: ['**']
  pull_request:
permissions:
  contents: read
concurrency:
  group: theme-validation-\${{ github.event_name }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  validate:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '22'
      - name: Validate and package offline
        run: |
          node tools/theme.mjs validate .
          node tools/theme.mjs package . --output theme-universal.zip
`;
}
