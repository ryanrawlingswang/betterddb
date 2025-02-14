# betterddb [IN DEVELOPMENT - NOT READY FOR PRODUCTION - BREAKING CHANGES]

**betterddb** is a definition-based DynamoDB wrapper library written in TypeScript. It provides a generic, schema-driven Data Access Layer (DAL) using [Zod](https://github.com/colinhacks/zod) for runtime validation and the AWS SDK for DynamoDB operations. With built-in support for compound keys, computed indexes, automatic timestamp injection, transactional and batch operations, and a fluent builder API for all CRUD operations (create, get, update, delete) as well as queries and scans, **betterddb** lets you work with DynamoDB using definitions instead of ad hoc query code.

---

## Installation

```bash
npm install betterddb
```

---

## Usage Example

Below is an example of using **betterddb** for a User entity with a compound key, and using the new fluent builder APIs for create, get, update, and delete, as well as for query and scan operations.

```ts
import { BetterDDB } from 'betterddb';
import { z } from 'zod';
import { DynamoDB } from 'aws-sdk';

// Define the User schema. Use .passthrough() to allow computed keys.
const UserSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().optional()
}).passthrough();

// Configure the DynamoDB DocumentClient (example using LocalStack)
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
      // Compute the partition key from tenantId.
      definition: { build: (raw) => `TENANT#${raw.tenantId}` }
    },
    sort: {
      name: 'sk',
      // Compute the sort key from userId.
      definition: { build: (raw) => `USER#${raw.userId}` }
    },
    gsis: {
      // Example: a Global Secondary Index on email.
      EmailIndex: {
        primary: { name: 'email', definition: 'email' }
      }
    }
  },
  client,
  autoTimestamps: true,
  entityName: 'USER'
});

(async () => {
  // ### Create Operation ###
  // Use the CreateBuilder to build and execute a create operation.
  const newUser = await userDdb.createBuilder({
    tenantId: 'tenant1',
    userId: 'user123',
    email: 'user@example.com',
    name: 'Alice'
  }).execute();
  console.log('Created User:', newUser);

  // ### Get Operation ###
  // Use the GetBuilder to retrieve an item. Optionally, use a projection.
  const user = await userDdb.getBuilder({ id: 'user123' })
    .withProjection(['name', 'email'])
    .execute();
  console.log('Retrieved User:', user);

  // ### Update Operation ###
  // Use the UpdateBuilder to perform a fluent update.
  const updatedUser = await userDdb.update({ tenantId: 'tenant1', userId: 'user123' }, 1)
    .set({ name: 'Jane Doe' })
    .remove(['obsoleteAttribute'])
    .execute();
  console.log('Updated User (immediate):', updatedUser);

  // Or build a transaction update item and include it in a transaction:
  const transactionUpdateItem = userDdb.update({ tenantId: 'tenant1', userId: 'user123' }, 1)
    .set({ name: 'Jane Doe' })
    .remove(['obsoleteAttribute'])
    .toTransactUpdate();
  // Assume transactWrite is available on BetterDDB for executing a transaction.
  await userDdb.transactWrite([transactionUpdateItem]);
  console.log('Updated User (transaction) executed.');

  // ### Delete Operation ###
  // Use the DeleteBuilder to delete an item with an optional condition.
  await userDdb.deleteBuilder({ id: 'user123' })
    .withCondition('#status = :expected', { ':expected': 'inactive' })
    .execute();
  console.log('User deleted');

  // ### Query Operation ###
  // Use the fluent QueryBuilder to query items.
  const queryResults = await userDdb.query({ tenantId: 'tenant1' })
    .where('name', 'begins_with', 'John')
    .limitResults(10);
  console.log('Query Results:', queryResults);

  // ### Scan Operation ###
  // Use the fluent ScanBuilder to scan the table with a filter.
  const scanResults = await userDdb.scan()
    .where('tenantId', 'eq', 'tenant1')
    .limitResults(50);
  console.log('Scan Results:', scanResults);
})();
```

---

## API Overview

**betterddb** exposes a generic class `BetterDDB<T>` with the following methods:

### Fluent CRUD Builders

- **CreateBuilder**  
  - `createBuilder(item: T): CreateBuilder<T>`  
  - Builds a put request with automatic timestamp and key computation.
  - Usage:  
    ```ts
    await betterDdb.createBuilder(item).execute();
    ```

- **GetBuilder**  
  - `getBuilder(key: Partial<T>): GetBuilder<T>`  
  - Builds a get request. Supports projections via `.withProjection()`.
  - Usage:  
    ```ts
    const result = await betterDdb.getBuilder({ id: 'user123' })
      .withProjection(['name', 'email'])
      .execute();
    ```

- **DeleteBuilder**  
  - `deleteBuilder(key: Partial<T>): DeleteBuilder<T>`  
  - Builds a delete request. Supports condition expressions via `.withCondition()`.
  - Usage:  
    ```ts
    await betterDdb.deleteBuilder({ id: 'user123' })
      .withCondition('#status = :expected', { ':expected': 'inactive' })
      .execute();
    ```

### Fluent Update Builder

- `update(key: Partial<T>, expectedVersion?: number): UpdateBuilder<T>`  
  - Provides chainable methods such as `.set()`, `.remove()`, `.add()`, and `.delete()`.
  - Also supports transaction mode:
    - `.toTransactUpdate()` returns a transaction item.
    - `.transactWrite([...])` allows you to combine update items in a transaction.
  - Usage:
    ```ts
    await betterDdb.update({ id: 'user123' }, 1)
      .set({ name: 'Jane Doe' })
      .remove(['obsoleteAttribute'])
      .execute();
    ```

### Fluent Query & Scan Builders

- **QueryBuilder**  
  - `query(key: Partial<T>): QueryBuilder<T>`  
  - Allows you to chain conditions (via `.where()`), sort direction, limits, and pagination.
  - Usage:
    ```ts
    const results = await betterDdb.query({ tenantId: 'tenant1' })
      .where('name', 'begins_with', 'John')
      .limitResults(10);
    ```

- **ScanBuilder**  
  - `scan(): ScanBuilder<T>`  
  - Provides a fluent API to filter and paginate scan operations.
  - Usage:
    ```ts
    const results = await betterDdb.scan()
      .where('tenantId', 'eq', 'tenant1')
      .limitResults(50);
    ```

### Batch and Transaction Operations

- **Batch Operations:**
  - `batchWrite(ops: { puts?: T[]; deletes?: Partial<T>[] }): Promise<void>`
  - `batchGet(rawKeys: Partial<T>[]): Promise<T[]>`

- **Transaction Helpers:**
  - `buildTransactPut(item: T)`
  - `buildTransactUpdate(rawKey: Partial<T>, update: Partial<T>, options?: { expectedVersion?: number })`
  - `buildTransactDelete(rawKey: Partial<T>)`
  - `transactWrite(...)` and `transactGetByKeys(...)`

For complete details, please refer to the API documentation.

---

## License

MIT
