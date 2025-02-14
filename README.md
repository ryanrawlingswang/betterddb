# betterddb

**betterddb** is a definition-based DynamoDB wrapper library written in TypeScript. It provides a generic, schema-driven Data Access Layer (DAL) using [Zod](https://github.com/colinhacks/zod) for runtime validation and the AWS SDK for DynamoDB operations. With built-in support for compound keys, computed indexes, automatic timestamp injection, transactional and batch operations, and pagination for queries, **betterddb** lets you work with DynamoDB using definitions instead of ad hoc query code.

## Installation

```bash
npm install betterddb
```

## Usage Example
Below is an example of using betterddb for a User entity with a compound key.

```ts
import { DynamoDAL } from 'betterddb';
import { z } from 'zod';

// Define a User schema with raw key parts and computed keys.
const UserSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  // Computed fields:
  pk: z.string(),
  sk: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().optional()
});

export type User = z.infer<typeof UserSchema>;

// Create an instance of the DAL with compound key definitions.
const userDal = new DynamoDAL<User>({
  schema: UserSchema,
  tableName: 'Users',
  keys: {
    pk: {
      field: 'pk',
      build: (raw) => `TENANT#${raw.tenantId}`
    },
    sk: {
      field: 'sk',
      build: (raw) => `USER#${raw.userId}`
    },
    gsis: {
      EmailIndex: { pk: 'email' }
    }
  },
  autoTimestamps: true
});

// Query by primary key with a sort key condition.
(async () => {
  const { items, lastKey } = await userDal.queryByPrimaryKey(
    { tenantId: 'tenant1' },
    { operator: 'begins_with', values: 'USER#user' },
    { limit: 10 }
  );
  console.log("Queried items:", items);
  if (lastKey) {
    console.log("More items exist; use lastKey for pagination:", lastKey);
  }
})();
API
betterddb exposes a generic class DynamoDAL<T> with methods for:

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

License
MIT

yaml

