import path from "path";

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
      ABI: path.resolve(process.cwd(), "test/fixtures/counter.abi.json"),
      TARGETS: {
        HARDHAT_V2: {
          folderPath: path.resolve(
            process.cwd(),
            "test/fixtures/counter_hardhat-v2",
          ),
          buildInfoPaths: [
            path.resolve(
              process.cwd(),
              "test/fixtures/counter_hardhat-v2/build-info/7096258467d93d9b25952a52f5cd299c.json",
            ),
          ],
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
        },
        HARDHAT_V3: {
          folderPath: path.resolve(
            process.cwd(),
            "test/fixtures/counter_hardhat-v3",
          ),
          buildInfoPaths: [
            path.resolve(
              process.cwd(),
              "test/fixtures/counter_hardhat-v3/build-info/solc-0_8_28-9b492fc1cb66c726cd4b3f1c153b6fdc920ba093.json",
            ),
          ],
          fullyQualifiedContractPaths: [
            "project/contracts/Counter.sol:Counter",
          ],
          exportExpectedResult: {
            path: "project/contracts/Counter.sol",
            name: "Counter",
          },
        },
        FOUNDRY_DEFAULT: {
          folderPath: path.resolve(
            process.cwd(),
            "test/fixtures/counter_foundry-default",
          ),
          buildInfoPaths: [
            path.resolve(
              process.cwd(),
              "test/fixtures/counter_foundry-default/build-info/c4816c11c9f24dea.json",
            ),
          ],
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
        },
        FOUNDRY_BUILD_INFO: {
          folderPath: path.resolve(
            process.cwd(),
            "test/fixtures/counter_foundry-build-info",
          ),
          buildInfoPaths: [
            path.resolve(
              process.cwd(),
              "test/fixtures/counter_foundry-build-info/build-info/ff181e7a2683ed8c.json",
            ),
          ],
          fullyQualifiedContractPaths: ["src/Counter.sol:Counter"],
          exportExpectedResult: {
            path: "src/Counter.sol",
            name: "Counter",
          },
        },
      },
    },
    // Group #2: Mix
    // InternalMath: internal library
    // ExternalMath: external library
    // Oracle: contract: depending of Ownable of OpenZeppelin
    // Counter contract: depending of InternalMath, ExternalMath and Oracle contracts
    MIX: {
      COUNTER_ABI: path.resolve(
        process.cwd(),
        "test/fixtures/mix.counter.abi.json",
      ),
      TARGETS: {
        HARDHAT_V2: {
          folderPath: path.resolve(
            process.cwd(),
            "test/fixtures/mix_hardhat-v2",
          ),
          buildInfoPaths: [
            path.resolve(
              process.cwd(),
              "test/fixtures/mix_hardhat-v2/build-info/963d2d0b62f97ac589d652e367f38cfe.json",
            ),
          ],
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
        },
      },
    },
  },
  PATHS: {
    TEMP_DIR_PREFIX: "ethoko-test-",
    FIXTURES: path.resolve(process.cwd(), "test/fixtures"),
  },
} as const;
