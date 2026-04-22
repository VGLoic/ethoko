# @ethoko/cli-beacon

## 0.11.0

### Minor Changes

- 8f39c87: A console.log used for debugging purpose has been removed. Logging in commands have been revisited and include less steps. Logs are shown when there is a dynamic pull from a specific command.

## 0.10.0

### Minor Changes

- e3eb42a: The typings command signature has been changed in order to accept an artifact, or a project as argument. The flags --all and --empty have been added in order to handle the all pulled artifacts or empty cases.
- c76c099: Enable dynamic pull for inspect, diff, restore and export commands: the artifact is pulled if not found in the cache.

## 0.9.0

### Minor Changes

- 3e4f5e1: Update documentation
- fcba00e: Expose prune command in order to clean up pulled artifacts.

## 0.8.0

### Minor Changes

- 10673b9: Introduce global config, expose `config` command in order to print the merged configuration and the managed projects.
- 561a527: Distinguis absolute and relative paths, protect against tag with delimiters
- 7470259: Rework init command to allow for new project addition and gitignore handling

## 0.7.0

### Minor Changes

- 421c051: Update configuration object to support multiple projects by default
- 4dfd5f3: Rename config ethoko.json to ethoko.config.json
- 47cd178: Update CLI log output
- 0c8963a: Rename "local" storage type to "filesystem"
- 5977b0f: Improve command parsing error messages

## 0.6.0

### Minor Changes

- 76ab8ef: Load template content directly in memory instead of relying on path

## 0.5.0

### Minor Changes

- 13b72f9: Inherit from @ethoko/core structure

## 0.4.0

### Minor Changes

- d3a919c: Improve CLI config parsing

### Patch Changes

- Updated dependencies [6f4447d]
  - @ethoko/core@0.11.0

## 0.3.0

### Minor Changes

- 7ef260f: Expose upgrade and uninstall commands

### Patch Changes

- Updated dependencies [72f85ae]
  - @ethoko/core@0.10.0

## 0.2.0

### Minor Changes

- 9366849: Initial release

### Patch Changes

- Updated dependencies [3f487b9]
- Updated dependencies [29aced9]
- Updated dependencies [ed133f0]
- Updated dependencies [1b5026a]
- Updated dependencies [2aec2db]
- Updated dependencies [2154b28]
- Updated dependencies [adc4cc7]
- Updated dependencies [0e9ed15]
- Updated dependencies [c8fb6f3]
- Updated dependencies [e522639]
  - @ethoko/core@0.9.0
