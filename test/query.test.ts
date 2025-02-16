import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDB } from 'aws-sdk';
import { createTestTable, deleteTestTable } from './utils/table-setup';

const TEST_TABLE = "query-test-table";
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';
const ENTITY_NAME = 'USER';
const PRIMARY_KEY = 'id';
const PRIMARY_KEY_TYPE = 'S';
const SORT_KEY = 'email';
const SORT_KEY_TYPE = 'S';
const KEY_SCHEMA = [{ AttributeName: PRIMARY_KEY, KeyType: 'HASH' }, { AttributeName: SORT_KEY, KeyType: 'RANGE' }];
const ATTRIBUTE_DEFINITIONS = [{ AttributeName: PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE }, { AttributeName: SORT_KEY, AttributeType: SORT_KEY_TYPE }];
const client = new DynamoDB.DocumentClient({
  region: REGION,
  endpoint: ENDPOINT,
});

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const userDdb = new BetterDDB({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityName: ENTITY_NAME,
  keys: {
    primary: { name: PRIMARY_KEY, definition: PRIMARY_KEY },
    gsis: {
      EmailIndex: {
        name: 'EmailIndex',
        primary: { name: 'email', definition: 'email' }
      }
    }
  },
  client,
  autoTimestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS);
  // Insert multiple items.
  const items = [
    { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    { id: 'user-2', name: 'Alice B', email: 'alice@example.com' },
    { id: 'user-3', name: 'Bob', email: 'bob@example.com' }
  ];
  for (const item of items) {
    await userDdb.create(item as any).execute();
  }
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Query Operation', () => {
  it('should query items using QueryBuilder', async () => {
    const results = await userDdb.query({ id: 'user-1' })
      .where('name', 'begins_with', 'Alice')
      .limitResults(5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach(result => {
      expect(result.name).toMatch(/^Alice/);
    });
  });
});
