import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AttributeDefinition, DynamoDB, GlobalSecondaryIndex, KeySchemaElement } from '@aws-sdk/client-dynamodb';
import { createTestTable, deleteTestTable } from './utils/table-setup';

const TEST_TABLE = "query-test-table";
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';
const ENTITY_TYPE = 'USER';
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
    KeySchema: [
      { AttributeName: GSI_PRIMARY_KEY, KeyType: 'HASH' },
      { AttributeName: GSI_SORT_KEY, KeyType: 'RANGE' }
    ],
    Projection: { ProjectionType: 'ALL' },
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
});

type User = z.infer<typeof UserSchema>;

const userDdb = new BetterDDB<User>({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityType: ENTITY_TYPE,
  keys: {
    primary: { 
      name: PRIMARY_KEY, 
      definition: { build: (raw) => `USER#${raw.id}` } 
    },
    sort: { 
      name: SORT_KEY, 
      definition: { build: (raw) => `USER#${raw.email}` } 
    },
    gsis: {
      EmailIndex: {
        name: 'EmailIndex',
        primary: { 
          name: GSI_PRIMARY_KEY, 
          definition: { build: (raw) => `USER#${raw.email}` } 
        },
        sort: { 
          name: GSI_SORT_KEY, 
          definition: { build: (raw) => `USER#${raw.email}` } 
        }
      }
    }
  },
  client,
  timestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);

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

describe('BetterDDB - Query Operation', () => {
  it('should query items using QueryBuilder with filter condition', async () => {
    const results = await userDdb.query({ id: 'user-1' })
      .filter('name', 'begins_with', 'Alice')
      .limitResults(5)
      .execute();
    expect(results.items.length).toBeGreaterThanOrEqual(1);
    results.items.forEach(result => {
      expect(result.name).toMatch(/^Alice/);
    });
  });

  it('should query items using QueryBuilder with index', async () => {
    const results = await userDdb.query({ email: 'alice@example.com' })
      .usingIndex('EmailIndex')
      .limitResults(1)
      .execute();
    expect(results.items.length).toEqual(1);
    results.items.forEach(result => {
      expect(result.email).toEqual('alice@example.com');
    });
  });

  it('should query items using QueryBuilder with a sort key condition', async () => {
    // For a complex sort key, users must supply an object.
    const results = await userDdb.query({ id: 'user-1' })
      .where('begins_with', { email: 'alice' })
      .execute();
    expect(results.items.length).toBeGreaterThanOrEqual(1);
    results.items.forEach(result => {
      expect(result.email).toMatch(/^alice/i);
    });
  });

  it('should return no results if the sort key condition does not match', async () => {
    const results = await userDdb.query({ id: 'user-1' })
      .where('begins_with', { email: 'bob' })
      .execute();
    expect(results.items.length).toEqual(0);
  });

  it('should query items using QueryBuilder with index and additional filter', async () => {
    const results = await userDdb.query({ email: 'alice@example.com' })
      .usingIndex('EmailIndex')
      .filter('name', 'begins_with', 'Alice')
      .execute();
    expect(results.items.length).toBeGreaterThanOrEqual(1);
    results.items.forEach(result => {
      expect(result.email).toEqual('alice@example.com');
      expect(result.name).toMatch(/^Alice/);
    });
  });


  it('should query items using QueryBuilder with a sort key condition using "between"', async () => {
    // Here we use the "between" operator. The sort key build function produces a value like "USER#alice@example.com"
    // We provide lower and upper bounds as objects.
    const results = await userDdb.query({ id: 'user-1' })
      .where('between', [
        { email: 'alice' },          // Lower bound -> built to "USER#alice"
        { email: 'alice@example.com' } // Upper bound -> built to "USER#alice@example.com"
      ])
      .execute();
    expect(results.items.length).toBeGreaterThanOrEqual(1);
    results.items.forEach(result => {
      // The built sort key for user-1 is "USER#alice@example.com"
      expect(result.email).toMatch(/alice@example\.com/i);
    });
  });

  it('should query items using QueryBuilder with multiple filter conditions on an index', async () => {
    // Query the GSI for email "alice@example.com". Two items match.
    // Then apply two filter conditions: name begins_with "Alice" and name contains "B" should only match one.
    const results = await userDdb.query({ email: 'alice@example.com' })
      .usingIndex('EmailIndex')
      .filter('name', 'begins_with', 'Alice')
      .filter('name', 'contains', 'B')
      .execute();
    expect(results.items.length).toEqual(1);
    results.items.forEach(result => {
      expect(result.name).toMatch(/^Alice/);
      expect(result.name).toContain('B');
    });
  });

  it('should query items using QueryBuilder with where clause on an index', async () => {
    // Query the GSI for email "alice@example.com". Two items match.
    // Then apply two filter conditions: name begins_with "Alice" and name contains "B" should only match one.
    const results = await userDdb.query({ email: 'alice@example.com' })
      .usingIndex('EmailIndex')
      .where('begins_with', { email: 'alice' })
      .execute();
    expect(results.items.length).toEqual(2);
  });
});
