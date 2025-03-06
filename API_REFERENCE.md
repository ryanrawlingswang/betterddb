# BetterDDB API Reference

This document provides a comprehensive reference for the BetterDDB library, explaining its classes, methods, and usage patterns.

## Table of Contents

- [Initialization](#initialization)
- [Schema Definition](#schema-definition)
- [CRUD Operations](#crud-operations)
  - [Create](#create)
  - [Read](#read)
  - [Update](#update)
  - [Delete](#delete)
- [Query Operations](#query-operations)
  - [Basic Queries](#basic-queries)
  - [Using Indexes](#using-indexes)
  - [Filtering](#filtering)
- [Scan Operations](#scan-operations)
- [Batch Operations](#batch-operations)
- [Transaction Operations](#transaction-operations)
- [Advanced Features](#advanced-features)
  - [Automatic Timestamps](#automatic-timestamps)
  - [Versioning](#versioning)

## Initialization

### BetterDDB Constructor

The main entry point for interacting with DynamoDB.

```typescript
constructor(options: BetterDDBOptions<T>)
```

#### Parameters

```typescript
export interface BetterDDBOptions<T> {
  schema: z.AnyZodObject;
  tableName: string;
  entityType?: string;
  keys: KeysConfig<T>;
  client: DynamoDBDocumentClient;
  counter?: boolean;
  timestamps?: boolean;
}
```

- **schema**: Zod schema for validation
- **tableName**: Your DynamoDB table name
- **entityType**: Optional type discriminator for multi-entity tables
- **keys**: Configuration for primary key, sort key, and GSIs
- **client**: AWS SDK v3 DynamoDB document client
- **counter**: Whether to use a counter field for optimistic locking
- **timestamps**: Whether to automatically manage `createdAt` and `updatedAt` timestamps

#### Example

```typescript
import { BetterDDB } from 'betterddb';
import { z } from 'zod';
import { DynamoDBDocumentClient, DynamoDB } from '@aws-sdk/lib-dynamodb';

// Define schema
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// Init client
const client = DynamoDBDocumentClient.from(new DynamoDB({
  region: 'us-east-1',
}));

// Initialize BetterDDB
const userDdb = new BetterDDB({
  schema: UserSchema,
  tableName: 'Users',
  keys: {
    primary: {
      name: 'pk',
      definition: { build: (raw) => `USER#${raw.id}` }
    },
    sort: {
      name: 'sk',
      definition: { build: (raw) => `PROFILE` }
    },
    gsis: {
      EmailIndex: {
        name: 'EmailIndex',
        primary: { 
          name: 'gsi1pk', 
          definition: 'email' 
        }
      }
    }
  },
  client,
  timestamps: true,
});
```

## Schema Definition

BetterDDB uses [Zod](https://github.com/colinhacks/zod) for schema validation and type inference. Your schema defines both runtime validation rules and TypeScript types.

### Basic Schema

```typescript
const Schema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

type Entity = z.infer<typeof Schema>; // TypeScript type inference
```

### Schema with Computed Fields

To allow for computed fields (like keys), use `.passthrough()`:

```typescript
const Schema = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();
```

## CRUD Operations

### Create

Creates a new item in the DynamoDB table with automatic validation and key computation.

```typescript
create(item: T): CreateBuilder<T>
```

#### CreateBuilder Methods

- **execute()**: Performs the create operation and returns the created item
- **withCondition(condition: string, expressionAttrs?: Record<string, any>)**: Adds a condition expression

#### Example

```typescript
// Simple create
const user = await userDdb.create({
  id: '123',
  name: 'Alice',
  email: 'alice@example.com'
}).execute();

// Create with condition
const user = await userDdb.create({
  id: '123',
  name: 'Alice',
  email: 'alice@example.com'
})
.withCondition('attribute_not_exists(#pk)', { '#pk': 'pk' })
.execute();
```

### Read

Retrieves items from the DynamoDB table.

```typescript
get(key: Partial<T>): GetBuilder<T>
```

#### GetBuilder Methods

- **execute()**: Performs the get operation and returns the item
- **withProjection(attributes: string[])**: Specifies which attributes to return
- **withConsistentRead(consistent: boolean)**: Uses consistent read

#### Example

```typescript
// Simple get
const user = await userDdb.get({ id: '123' }).execute();

// Get with projection
const userNameOnly = await userDdb.get({ id: '123' })
  .withProjection(['name', 'email'])
  .execute();
```

### Batch Get

Retrieves multiple items in a single operation.

```typescript
batchGet(keys: Partial<T>[]): BatchGetBuilder<T>
```

#### Example

```typescript
const users = await userDdb.batchGet([
  { id: '123' },
  { id: '456' }
]).execute();
```

### Update

Updates an existing item with automatic validation.

```typescript
update(key: Partial<T>, expectedVersion?: number): UpdateBuilder<T>
```

#### UpdateBuilder Methods

- **set(attributes: Partial<T>)**: Sets attributes to specific values
- **remove(attributes: string[])**: Removes attributes
- **add(attributes: Record<string, number>)**: Adds numeric values to attributes
- **delete(attributes: Record<string, any[]>)**: Removes elements from sets
- **withCondition(condition: string, expressionAttrs?: Record<string, any>)**: Adds a condition expression
- **execute()**: Performs the update operation and returns the updated item
- **toTransactUpdate()**: Converts the update to a transaction operation

#### Example

```typescript
// Simple update
const user = await userDdb.update({ id: '123' })
  .set({ name: 'Alice Smith' })
  .execute();

// Complex update
const user = await userDdb.update({ id: '123' }, 1) // Version check
  .set({ name: 'Alice Smith' })
  .remove(['oldField'])
  .add({ age: 1 })
  .withCondition('attribute_exists(#id)', { '#id': 'id' })
  .execute();
```

### Delete

Deletes an item from the DynamoDB table.

```typescript
delete(key: Partial<T>): DeleteBuilder<T>
```

#### DeleteBuilder Methods

- **execute()**: Performs the delete operation
- **withCondition(condition: string, expressionAttrs?: Record<string, any>)**: Adds a condition expression
- **toTransactDelete()**: Converts the delete to a transaction operation

#### Example

```typescript
// Simple delete
await userDdb.delete({ id: '123' }).execute();

// Delete with condition
await userDdb.delete({ id: '123' })
  .withCondition('#status = :status', { 
    '#status': 'status', 
    ':status': 'inactive' 
  })
  .execute();
```

## Query Operations

Performs a DynamoDB query operation with a fluent interface.

```typescript
query(keyCondition: Partial<T>): QueryBuilder<T>
```

### QueryBuilder Methods

- **execute()**: Performs the query operation and returns the results
- **where(operator: string, value: any)**: Adds a condition on the sort key
- **filter(attribute: keyof T, operator: string, value: any)**: Adds a filter condition
- **usingIndex(indexName: string)**: Specifies a GSI to query
- **limitResults(limit: number)**: Limits the number of results
- **scanDescending()**: Changes the scan direction to descending
- **startFrom(lastEvaluatedKey: Record<string, any>)**: Enables pagination

### Basic Queries

```typescript
// Query by primary key
const results = await userDdb.query({ id: '123' }).execute();

// Query with sort key condition
const results = await userDdb.query({ id: '123' })
  .where('begins_with', { email: 'a' })
  .execute();
```

### Using Indexes

```typescript
// Query using GSI
const results = await userDdb.query({ email: 'alice@example.com' })
  .usingIndex('EmailIndex')
  .execute();
```

### Filtering

```typescript
// Query with filter
const results = await userDdb.query({ id: '123' })
  .filter('age', '>', 21)
  .limitResults(10)
  .execute();

// Multiple filters
const results = await userDdb.query({ id: '123' })
  .filter('age', '>', 21)
  .filter('name', 'begins_with', 'A')
  .execute();
```

### Pagination

```typescript
const firstPage = await userDdb.query({ id: '123' })
  .limitResults(10)
  .execute();

if (firstPage.lastEvaluatedKey) {
  const secondPage = await userDdb.query({ id: '123' })
    .limitResults(10)
    .startFrom(firstPage.lastEvaluatedKey)
    .execute();
}
```

## Scan Operations

Performs a DynamoDB scan operation.

```typescript
scan(): ScanBuilder<T>
```

### ScanBuilder Methods

- **execute()**: Performs the scan operation and returns the results
- **filter(attribute: keyof T, operator: string, value: any)**: Adds a filter condition
- **limitResults(limit: number)**: Limits the number of results
- **startFrom(lastEvaluatedKey: Record<string, any>)**: Enables pagination
- **usingIndex(indexName: string)**: Specifies a GSI to scan

### Example

```typescript
// Simple scan
const results = await userDdb.scan().execute();

// Scan with filter
const results = await userDdb.scan()
  .filter('status', '==', 'active')
  .limitResults(100)
  .execute();
```

## Batch Operations

Performs multiple write operations in a single request.

```typescript
batchWrite(operations: { 
  puts?: T[]; 
  deletes?: Partial<T>[] 
}): Promise<void>
```

### Example

```typescript
await userDdb.batchWrite({
  puts: [
    { id: '123', name: 'Alice', email: 'alice@example.com' },
    { id: '456', name: 'Bob', email: 'bob@example.com' }
  ],
  deletes: [
    { id: '789' }
  ]
});
```

## Transaction Operations

Performs multiple operations atomically.

```typescript
transactWrite(transactItems: any[]): Promise<void>
```

### Example

```typescript
// Build transaction items
const createItem = userDdb.create({ 
  id: '123', 
  name: 'Alice', 
  email: 'alice@example.com' 
}).toTransactPut();

const updateItem = userDdb.update({ id: '456' })
  .set({ name: 'Bob Smith' })
  .toTransactUpdate();

const deleteItem = userDdb.delete({ id: '789' })
  .toTransactDelete();

// Execute transaction
await userDdb.transactWrite([
  createItem,
  updateItem,
  deleteItem
]);
```

## Advanced Features

### Automatic Timestamps

When enabled, BetterDDB automatically manages:

- **createdAt**: Set on item creation
- **updatedAt**: Set on item creation and updated on every update

Enable with:

```typescript
const ddb = new BetterDDB({
  // ...other options
  timestamps: true
});
```

### Versioning

Enables optimistic locking with version numbers.

```typescript
// Update with version checking
const user = await userDdb.update({ id: '123' }, 1) // Expected version
  .set({ name: 'Alice Smith' })
  .execute();
```

This will only update if the current version is 1, then increment it to 2.

### Counter

Enables automatic counter incrementing for items.

```typescript
const ddb = new BetterDDB({
  // ...other options
  counter: true
});
```

## Key Management

### Key Definitions

```typescript
export interface KeysConfig<T> {
  primary: PrimaryKeyConfig<T>;
  sort?: SortKeyConfig<T>;
  gsis?: Record<string, GSIConfig<T>>;
}

export interface PrimaryKeyConfig<T> {
  name: string;
  definition: KeyDefinition<T>;
}

export interface SortKeyConfig<T> {
  name: string;
  definition: KeyDefinition<T>;
}

export interface GSIConfig<T> {
  name: string;
  primary: PrimaryKeyConfig<T>;
  sort?: SortKeyConfig<T>;
}

export type KeyDefinition<T> =
  | keyof T
  | {
      build: (rawKey: Partial<T>) => string;
    };
```

### Using Raw Attribute Names

```typescript
const ddb = new BetterDDB<User>({
  keys: {
    primary: {
      name: 'pk',
      definition: 'id' // Use the raw 'id' attribute
    }
  }
});
```

### Using Computed Keys

```typescript
const ddb = new BetterDDB<User>({
  keys: {
    primary: {
      name: 'pk',
      definition: { 
        build: (raw) => `USER#${raw.id}` 
      }
    }
  }
});
``` 