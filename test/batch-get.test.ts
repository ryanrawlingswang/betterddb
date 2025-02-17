import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { createTestTable, deleteTestTable } from './utils/table-setup';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDB, GlobalSecondaryIndex } from '@aws-sdk/client-dynamodb';
import { KeySchemaElement, AttributeDefinition } from '@aws-sdk/client-dynamodb';
const TEST_TABLE = "batch-get-test-table";
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
    primary: { name: PRIMARY_KEY, definition: { build: (raw) => raw.id! } },
    sort: { name: SORT_KEY, definition: { build: (raw) => raw.email! } },
  },
  client,
  autoTimestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
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
    expect(users.some(user => user.id === 'user-123')).toBe(true);
    expect(users.some(user => user.id === 'user-124')).toBe(true);
  });
});
