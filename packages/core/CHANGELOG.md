# @ethoko/core

## 0.9.0

### Minor Changes

- 3f487b9: Support null gasEstimates field
- 29aced9: Update typings to favor nodenext target
- ed133f0: Generated typings generates constant for ABIs, helping for strong typing of the ABIs
- 1b5026a: Complete the export command output and the `EthokoContractArtifact` in typings with the `expandedMetada`. This is a parsed version of the `metadata` field, the `sources` are completed with the `content` found in the `input` artifact.
- 2aec2db: The handling of Hardhat v3 artifacts with multiple build info pairs is fixed
- 2154b28: The enumeration in the step tracking CLI message has been removed
- adc4cc7: Decouple retrieval methods for compilation input and output
- 0e9ed15: Distinguish isolated from non isolated builds in Hardhat v3
- c8fb6f3: Important changes have been done on the way to store the output compilation artifact. Previously, one single artifact contained the whole output. It has been migrated to one artifact per contract.
- e522639: Allow to use default AWS credentials chain

## 0.8.0

### Minor Changes

- 7ea6b60: Update generated typings with ID and format
- f4c21bf: Fix format field
- 190301d: Rework export command to export full contract artifact instead of only ABI

## 0.7.0

### Minor Changes

- 18b25af: restructure the storage of the build info artifact, split it into input and output parts. The ID derivation has been updated to consider only the input instead of the output.

## 0.6.0

### Minor Changes

- 33a8b4c: This is a test for CI integration

## 0.5.0

### Minor Changes

- 69364f7: Support missing compilation artifacts in Foundry compilation output

## 0.4.0

### Minor Changes

- 500d664: Add sync method for artifact retrieval in generated ts typings
- 92a28d3: Push original contract artifacts for all foundry compilation type, add support for test and scripts in case of Foundry
- 4d5f356: Update generated typings for contract artifact in order to be more aligned with respect to Hardhat Ignition or Hardhat Deploy expected types
- b82795a: Add contract artifacts to original content for hardhat v3
- 0c89eb1: Expose the restore command in order to restore original compilation output files
- 1589a88: Migrate from zod v3 to zod v4. Major performance improvements have been noticed.

## 0.3.0

### Minor Changes

- ed16a11: Fix CI restriction when identifying build info for Hardhat V3

## 0.2.0

### Minor Changes

- b7908ee: Add the export command in order to export contract ABI
- a028300: Add inspect command to artifact
- ba964c8: Fix type inference for Forge with Build Info
- ef295de: Add silent flag to commands
- 2a5a27b: Add json flag option for the `artifacts` command
- a8e5300: The command `list` has been renamed to `artifacts`
