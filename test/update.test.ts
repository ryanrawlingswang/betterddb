import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, deleteTestTable } from './utils/table-setup';
import { DynamoDB, GlobalSecondaryIndex, AttributeValue } from '@aws-sdk/client-dynamodb';
import { KeySchemaElement, AttributeDefinition } from '@aws-sdk/client-dynamodb';
const TEST_TABLE = "update-test-table";
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
  points: z.number().optional(),
  tags: z.set(z.string()).optional(),
});

type User = z.infer<typeof UserSchema>;

const userDdb = new BetterDDB<User>({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityType: ENTITY_TYPE,
  keys: {
    primary: { name: PRIMARY_KEY, definition: { build: (raw) => raw.id! } },
    sort: { name: SORT_KEY, definition: { build: (raw) => raw.email! } },
    gsis: { EmailIndex: { name: GSI_NAME, primary: { name: GSI_PRIMARY_KEY, definition: { build: (raw) => "EMAIL" } }, sort: { name: GSI_SORT_KEY, definition: { build: (raw) => `EMAIL#${raw.email}` } } } },
  },
  client,
  timestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
});

beforeEach(async () => {
  const initialUser: User = { id: 'user-123', name: 'John Doe', email: 'john@example.com' };
  await userDdb.create(initialUser).execute();
});

afterEach(async () => {
  await userDdb.delete({ id: 'user-123', email: 'john@example.com' }).execute();
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe('BetterDDB - Update Operation', () => {
  it('should update an existing item using UpdateBuilder', async () => {
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ name: 'Jane Doe' })
      .execute();
    expect(updatedUser.name).toBe('Jane Doe');
    expect(updatedUser.email).toBe('john@example.com');
  });

  it('should add optional attributes and remove them', async () => {
    // First add the optional attribute
    await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ points: 10, name: 'John Doe' })  // Maintain required field
      .execute();

    // Then remove it
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .remove(['points'])
      .execute();
    
    expect(updatedUser.points).toBeUndefined();
    expect(updatedUser.name).toBe('John Doe'); // Required field remains
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains
  });

  it('should add to a number attribute', async () => {
    // First set initial value with all required fields
    await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ points: 10, name: 'John Doe' })
      .execute();

    // Then add to it
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .add({ points: 5 })
      .execute();
    
    expect(updatedUser.points).toBe(15);
    expect(updatedUser.name).toBe('John Doe'); // Required field remains
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains
  });

  it('should add and remove from a set attribute', async () => {
    // First set initial value with all required fields
    await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ tags: new Set(['tag1']), name: 'John Doe' })
      .execute();

    // Add to set
    let updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .add({ tags: new Set(['tag2']) })
      .execute();
    
    expect(updatedUser.tags).toEqual(new Set(['tag1', 'tag2']));
    expect(updatedUser.name).toBe('John Doe'); // Required field remains
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains

    // Delete from set
    updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .delete({ tags: new Set(['tag1']) })
      .execute();
    
    expect(updatedUser.tags).toEqual(new Set(['tag2']));
    expect(updatedUser.name).toBe('John Doe'); // Required field remains
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains
  });

  it('should perform conditional updates', async () => {
    // Update only if name matches
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ name: 'John Smith' })
      .setCondition('#n = :n', {
        ':n': 'John Doe'
      }, {
        '#n': 'name'
      })
      .execute();
    
    expect(updatedUser.name).toBe('John Smith');
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains
  });

  it('should fail conditional updates when condition is not met', async () => {
    await expect(userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ name: 'John Smith' })
      .setCondition('#n = :n', {
        ':n': 'Wrong Name'
      }, {
        '#n': 'name'
      })
      .execute()).rejects.toThrow();
  });

  it('should perform transaction updates', async () => {
    // Create another user for the transaction
    const newUser: User = { id: 'user-456', name: 'Alice', email: 'alice@example.com' };
    await userDdb.create(newUser).execute();

    // Create a second update builder for the transaction
    const secondUpdate = userDdb.update({ id: 'user-456', email: 'alice@example.com' })
      .set({ name: 'Alice Updated' })
      .toTransactUpdate();

    // Update both users in a transaction
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ name: 'John Updated' })
      .transactWrite(secondUpdate)
      .execute();

    expect(updatedUser.name).toBe('John Updated');
    expect(updatedUser.email).toBe('john@example.com'); // Required field remains

    // Verify the other user was updated
    const otherUser = await userDdb.get({ id: 'user-456', email: 'alice@example.com' }).execute();
    expect(otherUser?.name).toBe('Alice Updated');
    expect(otherUser?.email).toBe('alice@example.com'); // Required field remains
  });

  it('should fail validation when setting invalid values', async () => {
    // This should fail at schema validation level
    const builder = userDdb.update({ id: 'user-123', email: 'john@example.com' });
    
    // The validation should happen immediately when setting invalid values
    expect(() => builder.set({ email: 'invalid-email' }))
      .toThrow(z.ZodError);
    
    // Verify the error message
    try {
      builder.set({ email: 'invalid-email' });
      fail('Should have thrown a validation error');
    } catch (error) {
      if (error instanceof z.ZodError) {
        expect(error.errors[0].message).toBe('Invalid email');
      } else {
        fail('Expected ZodError');
      }
    }
  });

  it('should fail when updating non-existent item', async () => {
    await expect(userDdb.update({ id: 'non-existent', email: 'none@example.com' })
      .set({ name: 'New Name' })
      .execute()).rejects.toThrow();
  });

  it('should update index attributes when modifying indexed fields', async () => {
    // First verify the initial state
    const initialUser = await userDdb.get({ id: 'user-123', email: 'john@example.com' }).execute();
    expect(initialUser).toBeTruthy();

    // Update the email which should trigger index updates
    const updatedUser = await userDdb.update({ id: 'user-123', email: 'john@example.com' })
      .set({ email: 'john.updated@example.com' })
      .execute();

    // Verify the main attributes were updated
    expect(updatedUser.email).toBe('john.updated@example.com');
    expect(updatedUser.name).toBe('John Doe'); // Required field remains

    // Verify the index attributes were updated
    expect(updatedUser.email).toBe('john.updated@example.com');

    // Verify we can query using the new index values
    const queriedUser = await userDdb.query({ email: 'john.updated@example.com' })
      .usingIndex(GSI_NAME)
      .where('==', { email: 'john.updated@example.com' })
      .execute();
    expect(queriedUser.items).toHaveLength(1);
    expect(queriedUser.items[0].id).toBe('user-123');
  });
});
