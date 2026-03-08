# @ethoko/cli

Standalone CLI for Ethoko artifact management.

## Quick Start

1. Create `ethoko.json`:

```json
{
  "project": "my-contracts",
  "storage": {
    "type": "local",
    "path": ".ethoko-storage"
  }
}
```

2. Push artifacts:

```bash
ethoko push --artifact-path out/build-info --tag v1.0.0
```

3. Pull artifacts:

```bash
ethoko pull --tag v1.0.0
```
