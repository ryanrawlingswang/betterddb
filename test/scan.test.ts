import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDB, GlobalSecondaryIndex } from '@aws-sdk/client-dynamodb';
import { createTestTable, deleteTestTable } from './utils/table-setup';
import { KeySchemaElement, AttributeDefinition } from '@aws-sdk/client-dynamodb';
const TEST_TABLE = "scan-test-table";
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';
const ENTITY_NAME = 'USER';
const PRIMARY_KEY = 'pk';
const PRIMARY_KEY_TYPE = 'S';
const SORT_KEY = 'sk';
const SORT_KEY_TYPE = 'S';
const GSI_NAME = 'EmailIndex';
const GSI_PRIMARY_KEY = 'gsi1pk';
const GSI_SORT_KEY = 'gsi1sk';
const KEY_SCHEMA = [
  { AttributeName: PRIMARY_KEY, KeyType: 'HASH' },
  { AttributeName: SORT_KEY, KeyType: 'RANGE' }
] as KeySchemaElement[];
const ATTRIBUTE_DEFINITIONS = [
  { AttributeName: PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE },
  { AttributeName: SORT_KEY, AttributeType: SORT_KEY_TYPE },
  { AttributeName: GSI_PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE },
  { AttributeName: GSI_SORT_KEY, AttributeType: SORT_KEY_TYPE },
] as AttributeDefinition[];
const GSIS = [
  {
    IndexName: GSI_NAME,
    KeySchema: [{ AttributeName: GSI_PRIMARY_KEY, KeyType: 'HASH' }, { AttributeName: GSI_SORT_KEY, KeyType: 'RANGE' }],
    Projection: {
      ProjectionType: 'ALL',
    },
  },
] as GlobalSecondaryIndex[];
const client = DynamoDBDocumentClient.from(new DynamoDB({
  region: REGION,
  endpoint: ENDPOINT,
}));


const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type User = z.infer<typeof UserSchema>;

const userDdb = new BetterDDB({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityName: ENTITY_NAME,
  keys: {
    primary: { name: PRIMARY_KEY, definition: { build: (raw) => `USER#${raw.id}` } },
    sort: { name: SORT_KEY, definition: { build: (raw) => `EMAIL#${raw.email}` } },
  },
  client,
  autoTimestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
  // Insert multiple items.
  const items = [
    { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    { id: 'user-2', name: 'Alice B', email: 'alice@example.com' },
    { id: 'user-3', name: 'Bob', email: 'bob@example.com' }
  ];
  await Promise.all(items.map(item => userDdb.create(item as any).execute()));
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Scan Operation', () => {
  it('should scan items using ScanBuilder', async () => {
    const results = await userDdb.scan()
      .where('email', 'begins_with', 'a')
      .limitResults(10).execute();
    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach(result => {
      expect(result.email).toMatch(/^alice/i);
    });
  });

  it('should scan items using ScanBuilder with a contains filter', async () => {
    // Scan for users whose name contains "Alice"
    const results = await userDdb.scan()
        .where('name', 'contains', 'Alice')
        .limitResults(10)
        .execute();
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
      expect(result.name).toContain('Alice');
      });
  });

  it('should scan items using ScanBuilder with a between filter on email', async () => {
    // Using lexicographical order on the email address:
    // 'alice@example.com' should be between "a" and "c".
    const results = await userDdb.scan()
      .where('email', 'between', ['a', 'c'])
      .execute();
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      // A simple lexicographical check
      expect(result.email >= 'a' && result.email <= 'c').toBeTruthy();
    });
  });
});
