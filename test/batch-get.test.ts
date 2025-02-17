import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { createTestTable, deleteTestTable } from './utils/table-setup';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { KeySchemaElement, AttributeDefinition } from '@aws-sdk/client-dynamodb';
const TEST_TABLE = "batch-get-test-table";
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';
const ENTITY_NAME = 'USER';
const PRIMARY_KEY = 'id';
const PRIMARY_KEY_TYPE = 'S';
const SORT_KEY = 'email';
const SORT_KEY_TYPE = 'S';
const KEY_SCHEMA = [{ AttributeName: PRIMARY_KEY, KeyType: 'HASH' }, { AttributeName: SORT_KEY, KeyType: 'RANGE' }] as KeySchemaElement[];
const ATTRIBUTE_DEFINITIONS = [{ AttributeName: PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE }, { AttributeName: SORT_KEY, AttributeType: SORT_KEY_TYPE }] as AttributeDefinition[];
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
    primary: { name: PRIMARY_KEY, definition: { build: (raw) => raw.id! } },
    sort: { name: SORT_KEY, definition: { build: (raw) => raw.email! } },
  },
  client,
  autoTimestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS);
  await userDdb.create({ id: 'user-123', name: 'John Doe', email: 'john@example.com' } as any).execute();
  await userDdb.create({ id: 'user-124', name: 'John Doe', email: 'john@example.com' } as any).execute();
  await userDdb.create({ id: 'user-125', name: 'Bob Doe', email: 'bob@example.com' } as any).execute();
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Get Operation', () => {
  it('should retrieve an item using GetBuilder', async () => {
    const users = await userDdb.batchGet([{ id: 'user-123', email: 'john@example.com' }, { id: 'user-124', email: 'john@example.com' }]).execute();
    expect(users.length).toEqual(2);
    expect(users[0].id).toBe('user-123');
    expect(users[1].id).toBe('user-124');
  });
});
