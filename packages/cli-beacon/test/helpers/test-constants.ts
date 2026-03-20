import { AbsolutePath } from "@/utils/path";

export const TEST_CONSTANTS = {
  LOCALSTACK: {
    ENDPOINT: "http://localhost:4566",
    REGION: "us-east-1",
    ACCESS_KEY_ID: "test",
    SECRET_ACCESS_KEY: "test",
  },
  BUCKET_NAME: "ethoko-test-bucket",
  PROJECTS: {
    DEFAULT: "default-project",
    MULTI_ARTIFACT: "multi-artifact-project",
    FORCE_TEST: "force-test-project",
  },
  TAGS: {
    V1: "v1.0.0",
    V2: "v2.0.0",
    LATEST: "latest",
  },
  ARTIFACTS_FIXTURES: {
    // Group #1: Unique Counter contract
    COUNTER: {
      TARGETS: {
        HARDHAT_V2: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter_hardhat-v2",
          ),
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter.abi.json",
          ),
        },
        HARDHAT_V3: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter_hardhat-v3",
          ),
          fullyQualifiedContractPaths: [
            "project/contracts/Counter.sol:Counter",
          ],
          exportExpectedResult: {
            path: "project/contracts/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter.abi.json",
          ),
        },
        FOUNDRY_DEFAULT: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter_foundry-default",
          ),
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter.abi.json",
          ),
        },
        FOUNDRY_BUILD_INFO: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter_foundry-build-info",
          ),
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/counter.abi.json",
          ),
        },
      },
    },
    // Group #2: Mix
    // InternalMath: internal library
    // ExternalMath: external library
    // Oracle: contract: depending of Ownable of OpenZeppelin
    // Counter contract: depending of InternalMath, ExternalMath and Oracle contracts
    MIX: {
      TARGETS: {
        HARDHAT_V2: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix_hardhat-v2",
          ),
          fullyQualifiedContractPaths: [
            "@openzeppelin/contracts/access/Ownable.sol:Ownable",
            "@openzeppelin/contracts/utils/Context.sol:Context",
            "src/Counter.sol:Counter",
            "src/ExternalMath.sol:ExternalMath",
            "src/InternalMath.sol:InternalMath",
            "src/Oracle.sol:Oracle",
          ],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix.counter.abi.json",
          ),
        },
        HARDHAT_V3_ISOLATED_BUILD: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix_hardhat-v3-isolated-build",
          ),
          fullyQualifiedContractPaths: [
            "npm/@openzeppelin/contracts@5.6.1/access/Ownable.sol:Ownable",
            "npm/@openzeppelin/contracts@5.6.1/utils/Context.sol:Context",
            "project/contracts/Counter.sol:Counter",
            "project/contracts/ExternalMath.sol:ExternalMath",
            "project/contracts/InternalMath.sol:InternalMath",
            "project/contracts/Oracle.sol:Oracle",
          ],
          exportExpectedResult: {
            path: "project/contracts/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix.counter.abi.json",
          ),
        },
        HARDHAT_V3_NON_ISOLATED_BUILD: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix_hardhat-v3-non-isolated-build",
          ),
          fullyQualifiedContractPaths: [
            "npm/@openzeppelin/contracts@5.6.1/access/Ownable.sol:Ownable",
            "npm/@openzeppelin/contracts@5.6.1/utils/Context.sol:Context",
            "project/contracts/Counter.sol:Counter",
            "project/contracts/ExternalMath.sol:ExternalMath",
            "project/contracts/InternalMath.sol:InternalMath",
            "project/contracts/Oracle.sol:Oracle",
          ],
          exportExpectedResult: {
            path: "project/contracts/Counter.sol",
            name: "Counter",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix.counter.abi.json",
          ),
        },
        FOUNDRY_DEFAULT: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix_foundry-default",
          ),
          fullyQualifiedContractPaths: [
            "lib/openzeppelin-contracts/contracts/access/Ownable.sol:Ownable",
            "lib/openzeppelin-contracts/contracts/utils/Context.sol:Context",
            "src/Counter.sol:Counter",
            "src/ExternalMath.sol:ExternalMath",
            "src/InternalMath.sol:InternalMath",
            "src/Oracle.sol:Oracle",
          ],
          exportExpectedResult: {
            name: "Counter",
            path: "src/Counter.sol",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix.counter.abi.json",
          ),
        },
        FOUNDRY_BUILD_INFO: {
          folderPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix_foundry-build-info",
          ),
          fullyQualifiedContractPaths: [
            "lib/openzeppelin-contracts/contracts/access/Ownable.sol:Ownable",
            "lib/openzeppelin-contracts/contracts/utils/Context.sol:Context",
            "src/Counter.sol:Counter",
            "src/ExternalMath.sol:ExternalMath",
            "src/InternalMath.sol:InternalMath",
            "src/Oracle.sol:Oracle",
          ],
          exportExpectedResult: {
            name: "Counter",
            path: "src/Counter.sol",
          },
          abiPath: new AbsolutePath(
            process.cwd(),
            "test/fixtures/mix.counter.abi.json",
          ),
        },
      },
    },
  },
  PATHS: {
    TEMP_DIR_PREFIX: "ethoko-test-",
    FIXTURES: new AbsolutePath(process.cwd(), "test/fixtures"),
  },
} as const;
