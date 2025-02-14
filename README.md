# betterddb

**betterddb** is a definition-based DynamoDB wrapper library written in TypeScript. It provides a generic, schema-driven Data Access Layer (DAL) using [Zod](https://github.com/colinhacks/zod) for runtime validation and the AWS SDK for DynamoDB operations. With built-in support for compound keys, computed indexes, automatic timestamp injection, transactional and batch operations, and pagination for queries, **betterddb** lets you work with DynamoDB using definitions instead of ad hoc query code.

## Installation

```bash
npm install betterddb
```

## Usage Example
Below is an example of using betterddb for a User entity with a compound key.

```ts
import { BetterDDB } from 'betterddb';
import { z } from 'zod';
import { DynamoDB } from 'aws-sdk';

// Define the User schema. Use .passthrough() if you want to allow extra keys (e.g. computed keys).
const UserSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().optional()
});

// Configure the DynamoDB DocumentClient (for example, using LocalStack)
const client = new DynamoDB.DocumentClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566'
});

// Initialize BetterDDB with compound key definitions.
const userDdb = new BetterDDB({
  schema: UserSchema,
  tableName: 'Users',
  keys: {
    primary: {
      name: 'pk',
      // Compute the partition key from tenantId
      definition: { build: (raw) => `TENANT#${raw.tenantId}` }
    },
    sort: {
      name: 'sk',
      // Compute the sort key from userId
      definition: { build: (raw) => `USER#${raw.userId}` }
    },
    gsis: {
      // Example: a Global Secondary Index on email.
      EmailIndex: {
        primary: {
          name: 'email',
          definition: 'email'
        }
      }
    }
  },
  client,
  autoTimestamps: true
});

// Use the BetterDDB instance to create and query items.
(async () => {
  // Create a new user.
  const newUser = await userDdb.create({
    tenantId: 'tenant1',
    userId: 'user123',
    email: 'user@example.com',
    name: 'Alice'
  });
  console.log('Created User:', newUser);

  // Query by primary key with an optional sort key condition.
  const { items, lastKey } = await userDdb.queryByPrimaryKey(
    { tenantId: 'tenant1' },
    { operator: 'begins_with', values: 'USER#user' },
    { limit: 10 }
  );
  console.log('Queried Items:', items);
  if (lastKey) {
    console.log('More items available. Use lastKey for pagination:', lastKey);
  }
})();
```

## API
betterddb exposes a generic class DynamoDAL<T> with methods for:

```ts
create(item: T): Promise<T>
get(rawKey: Partial<T>): Promise<T | null>
update(rawKey: Partial<T>, update: Partial<T>, options?: { expectedVersion?: number }): Promise<T>
delete(rawKey: Partial<T>): Promise<void>
queryByGsi(gsiName: string, key: Partial<T>, sortKeyCondition?: { operator: "eq" | "begins_with" | "between"; values: any | [any, any] }): Promise<T[]>
queryByPrimaryKey(rawKey: Partial<T>, sortKeyCondition?: { operator: "eq" | "begins_with" | "between"; values: any | [any, any] }, options?: { limit?: number; lastKey?: Record<string, any> }): Promise<{ items: T[]; lastKey?: Record<string, any> }>
Batch operations:
batchWrite(ops: { puts?: T[]; deletes?: Partial<T>[] }): Promise<void>
batchGet(rawKeys: Partial<T>[]): Promise<T[]>
Transaction helper methods:
buildTransactPut(item: T)
buildTransactUpdate(rawKey: Partial<T>, update: Partial<T>, options?: { expectedVersion?: number })
buildTransactDelete(rawKey: Partial<T>)
transactWrite(...) and transactGetByKeys(...)
For complete details, please refer to the API documentation.
```

License
MIT
