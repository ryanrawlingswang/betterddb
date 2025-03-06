# BetterDDB

[![npm version](https://badge.fury.io/js/betterddb.svg)](https://badge.fury.io/js/betterddb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**BetterDDB** is a type-safe DynamoDB wrapper library that combines runtime validation with compile-time type checking. It provides a high-level, opinionated interface for DynamoDB operations with built-in schema validation using [Zod](https://github.com/colinhacks/zod).

## Key Features

- 🔒 **Type Safety**: Full TypeScript support with compile-time type checking using `zod.infer<T>`
- ✨ **Runtime Validation**: Schema validation using Zod ensures data integrity
- 🎯 **Smart Key Management**: Automatic computation of partition keys, sort keys, and GSI keys
- 🛠️ **Fluent Query API**: Intuitive builder pattern for all DynamoDB operations
- ⚡ **Developer Experience**: Reduced boilerplate and improved code maintainability
- 🔄 **Built-in Conveniences**: Automatic timestamp handling, versioning support

## Installation

```bash
npm install betterddb
```

## Quick Start

```typescript
import { BetterDDB } from 'betterddb';
import { z } from 'zod';
import { DynamoDBDocumentClient, DynamoDB } from '@aws-sdk/lib-dynamodb';

// 1. Define your schema with Zod
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Type inference from schema
type User = z.infer<typeof UserSchema>;

// 2. Initialize DynamoDB client
const client = DynamoDBDocumentClient.from(new DynamoDB({
  region: 'us-east-1',
}));

// 3. Create your BetterDDB instance
const userDdb = new BetterDDB<User>({
  schema: UserSchema,
  tableName: 'Users',
  entityType: 'USER',
  keys: {
    primary: { 
      name: 'pk', 
      definition: { build: (raw) => `USER#${raw.id}` } 
    },
    sort: { 
      name: 'sk', 
      definition: { build: (raw) => `EMAIL#${raw.email}` } 
    },
    gsis: {
      EmailIndex: {
        name: 'EmailIndex',
        primary: { 
          name: 'gsi1pk', 
          definition: { build: (raw) => `USER#${raw.email}` } 
        },
        sort: { 
          name: 'gsi1sk', 
          definition: { build: (raw) => `USER#${raw.email}` } 
        }
      }
    }
  },
  client,
  timestamps: true,
});

// 4. Use the fluent API for operations
async function example() {
  // Create with automatic validation
  const user = await userDdb.create({
    id: 'user-123',
    name: 'Alice',
    email: 'alice@example.com'
  }).execute();

  // Query with type-safe filters
  const results = await userDdb.query({ email: 'alice@example.com' })
    .usingIndex('EmailIndex')
    .filter('name', 'begins_with', 'A')
    .limitResults(10)
    .execute();

  // Update with automatic timestamp handling
  const updated = await userDdb.update({ id: 'user-123' })
    .set({ name: 'Alice B.' })
    .execute();
}
```

## Core Concepts

### Schema Validation

BetterDDB uses Zod for both runtime validation and TypeScript type inference:

```typescript
const Schema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
}).passthrough(); // Allow computed fields

type Entity = z.infer<typeof Schema>; // TypeScript type inference
```

### Key Management

Define how your keys should be computed from your entity:

```typescript
const ddb = new BetterDDB<User>({
  keys: {
    primary: {
      name: 'pk',
      definition: { build: (raw) => `USER#${raw.id}` }
    },
    sort: {
      name: 'sk',
      definition: { build: (raw) => `TYPE#${raw.type}` }
    }
  }
});
```

### Query Building

Fluent API for building type-safe queries:

```typescript
const results = await ddb.query({ id: 'user-123' })
  .usingIndex('EmailIndex')
  .where('begins_with', { email: 'alice' })
  .filter('name', 'contains', 'Smith')
  .limitResults(10)
  .execute();
```

## API Reference

For detailed API documentation, see our [API Reference](API_REFERENCE.md).

This documentation covers:

- Initialization and configuration
- CRUD operations (Create, Read, Update, Delete)
- Query and Scan operations with filtering
- Batch and transaction operations
- Advanced features like automatic timestamps and versioning
- Schema validation and key management

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT © Ryan Krumholz
