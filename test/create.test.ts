import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDB } from 'aws-sdk';
import { createTestTable, deleteTestTable } from './utils/table-setup';

const TEST_TABLE = "create-test-table";
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
}).passthrough();

const userDdb = new BetterDDB({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityName: ENTITY_NAME,
  keys: {
    primary: { name: "pk", definition: { build: (raw) => `USER#${raw.id}` } },
    sort: { name: "sk", definition: { build: (raw) => `EMAIL#${raw.email}` } },
    gsis: { gsi1: { name: 'gsi1', primary: { name: "gsi1pk", definition: { build: (raw) => "NAME" } }, sort: { name: "gsi1sk", definition: { build: (raw) => `NAME#${raw.name}` } } } },
  },
  client,
  autoTimestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS);
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Create Operation', () => {
  it('should insert an item using CreateBuilder', async () => {
    const user = { id: 'user-123', name: 'John Doe', email: 'john@example.com' };

    await userDdb.create(user as any).execute();

    const result = await client.get({ TableName: TEST_TABLE, Key: { id: 'user-123', email: 'john@example.com' } }).promise();

    expect(result).not.toBeNull();
    expect(result.Item).not.toBeNull();
    expect(result.Item?.pk).toBe('USER#user-123');
    expect(result.Item?.sk).toBe('EMAIL#john@example.com');
    expect(result.Item?.gsi1pk).toBe('NAME');
    expect(result.Item?.gsi1sk).toBe('NAME#John Doe');
    expect(result.Item?.id).toBe('user-123');
    expect(result.Item?.createdAt).not.toBeNull();
    expect(result.Item?.updatedAt).not.toBeNull();
  });

  it('should fails to validate and not insert an item', async () => {
    const user = { id: 'user-123', email: 'john@example.com' };
    await expect(userDdb.create(user as any).execute()).rejects.toThrow();
  });
});
