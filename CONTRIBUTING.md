# Contributing to BetterDDB

First off, thank you for considering contributing to BetterDDB! It's people like you that make BetterDDB such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps which reproduce the problem
* Provide specific examples to demonstrate the steps
* Describe the behavior you observed after following the steps
* Explain which behavior you expected to see instead and why
* Include code samples and error messages if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* Use a clear and descriptive title
* Provide a step-by-step description of the suggested enhancement
* Provide specific examples to demonstrate the steps
* Describe the current behavior and explain which behavior you expected to see instead
* Explain why this enhancement would be useful

### Pull Requests

* Fork the repo and create your branch from `main`
* If you've added code that should be tested, add tests
* Ensure the test suite passes
* Make sure your code lints
* Update the documentation

## Development Setup

1. Fork and clone the repo
2. Run `npm install` to install dependencies
3. Start LocalStack for DynamoDB testing: `docker-compose up -d`
4. Run `npm test` to run the tests
5. Create a branch for your changes

### Local Development Environment

```bash
# Install dependencies
npm install

# Start LocalStack (required for tests)
docker-compose up -d

# Run tests
npm test

# Run linter
npm run lint

# Build the project
npm run build
```

## Testing

We use Jest for testing against a local DynamoDB instance provided by LocalStack. All tests can be found in the `test/` directory.

### Test Directory Structure

```
test/
  ├── create.test.ts    # Tests for create operations
  ├── get.test.ts       # Tests for get operations
  ├── update.test.ts    # Tests for update operations
  ├── delete.test.ts    # Tests for delete operations
  ├── query.test.ts     # Tests for query operations
  ├── scan.test.ts      # Tests for scan operations
  ├── batch-get.test.ts # Tests for batch get operations
  └── utils/
      └── table-setup.ts # Utilities for setting up test tables
```

### Writing Tests

Each test file focuses on a specific aspect of the library. Tests should follow this pattern:

1. **Setup**: Define schema, table configuration, and BetterDDB instance
2. **Initialize**: Create the test table in LocalStack before tests run
3. **Test**: Write test cases for specific functionality
4. **Cleanup**: Delete the test table after tests complete

Here's an example of a basic test structure:

```typescript
import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { createTestTable, deleteTestTable } from './utils/table-setup';

// Constants for test configuration
const TEST_TABLE = "my-test-table";
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';

// Define schema and key configuration
const MySchema = z.object({
  id: z.string(),
  name: z.string(),
});

// Create DynamoDB client
const client = DynamoDBDocumentClient.from(new DynamoDB({
  region: REGION,
  endpoint: ENDPOINT,
}));

// Create BetterDDB instance
const myDdb = new BetterDDB({
  schema: MySchema,
  tableName: TEST_TABLE,
  keys: {
    primary: { 
      name: 'pk', 
      definition: { build: (raw) => `ITEM#${raw.id}` } 
    },
    sort: { 
      name: 'sk', 
      definition: { build: (raw) => `ITEM` } 
    }
  },
  client,
  timestamps: true,
});

// Setup and teardown
beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

// Test cases
describe('My Feature', () => {
  it('should do something specific', async () => {
    // Test implementation
    const result = await myDdb.create({ id: '123', name: 'Test' }).execute();
    expect(result.id).toBe('123');
  });
});
```

### Testing Utilities

The `test/utils/table-setup.ts` file provides utilities for creating and deleting DynamoDB tables for testing:

- **createTestTable**: Creates a DynamoDB table in LocalStack with the specified configuration
- **deleteTestTable**: Deletes a DynamoDB table from LocalStack

### Testing Best Practices

1. **Isolated Tests**: Each test should be independent and not rely on other tests
2. **Clean up after tests**: Always delete created resources to avoid interference
3. **Test error cases**: Include tests for failure scenarios, not just success
4. **Use constants**: Define table names, key names, etc. as constants
5. **Test both simple and complex scenarios**: Cover the full range of functionality
6. **Add tests for new features**: Any new functionality should have corresponding tests

### Testing against LocalStack

Tests run against a LocalStack instance, which provides a local DynamoDB implementation. To use this:

1. Ensure Docker is installed and running
2. Start LocalStack with `docker-compose up -d`
3. Run tests with `npm test`

The `docker-compose.yml` file in the repository configures the LocalStack environment.

## Style Guide

* We use ESLint and Prettier for code formatting
* TypeScript is required for all new code
* Follow the existing code style
* Write descriptive commit messages
* Add tests for new features
* Update documentation for changes

## Project Structure

```
src/
  ├── builders/     # Query builders
  ├── errors/       # Custom error types
  ├── types/        # TypeScript type definitions
  ├── betterddb.ts  # Main class
  └── index.ts      # Public API
test/
  ├── *.test.ts     # Test files
  └── utils/        # Test utilities
```

## Documentation

* Keep README.md updated
* Document new features
* Keep code comments clear and relevant
* Update TypeScript types
* Update API_REFERENCE.md with new functionality

## Community

* Join our [Discussions](https://github.com/ryankrumholz/betterddb/discussions)

## Questions?

Feel free to open an issue or join our discussions if you have any questions.

Thank you for contributing! 🎉 