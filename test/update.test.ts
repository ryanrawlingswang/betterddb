import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDB } from 'aws-sdk';
import { createTestTable, deleteTestTable } from './utils/table-setup';

const TEST_TABLE = "update-test-table";
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
  version: z.number().optional(),
}).passthrough();

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
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Update Operation', () => {
  it('should update an existing item using UpdateBuilder', async () => {
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' }).set({ name: 'Jane Doe' }).execute();
    expect(updatedUser.name).toBe('Jane Doe');
    expect(updatedUser.email).toBe('john@example.com');
  });
});
