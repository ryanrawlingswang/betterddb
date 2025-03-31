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
  },
  client,
  timestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
  const initialUser: User = { id: 'user-123', name: 'John Doe', email: 'john@example.com' };
  await userDdb.create(initialUser).execute();
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
});

describe('BetterDDB - Key Updates', () => {
  describe('Simple Key Definitions', () => {
    const simpleKeyDdb = new BetterDDB<User>({
      schema: UserSchema,
      tableName: TEST_TABLE,
      entityType: ENTITY_TYPE,
      keys: {
        primary: { name: PRIMARY_KEY, definition: 'id' },
        sort: { name: SORT_KEY, definition: 'email' },
      },
      client,
      timestamps: true,
    });

    beforeEach(async () => {
      const user: User = { 
        id: 'simple-1', 
        name: 'Simple Key User', 
        email: 'simple@example.com' 
      };
      await simpleKeyDdb.create(user).execute();
    });

    it('should handle primary key updates through create-and-delete transaction', async () => {
      // The update should internally create a new item and delete the old one
      const updatedUser = await simpleKeyDdb.update({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      })
        .set({ id: 'simple-1-new' })
        .execute();

      expect(updatedUser.id).toBe('simple-1-new');
      expect(updatedUser.name).toBe('Simple Key User'); // Other attributes preserved
      expect(updatedUser.email).toBe('simple@example.com');

      // Verify we can get with new key
      const retrieved = await simpleKeyDdb.get({ 
        id: 'simple-1-new', 
        email: 'simple@example.com' 
      }).execute();
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe('simple-1-new');
      expect(retrieved?.name).toBe('Simple Key User');

      // Verify old item was deleted
      const oldUser = await simpleKeyDdb.get({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      }).execute();
      expect(oldUser).toBeNull();
    });

    it('should handle sort key updates through create-and-delete transaction', async () => {
      const updatedUser = await simpleKeyDdb.update({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      })
        .set({ email: 'simple.new@example.com' })
        .execute();

      expect(updatedUser.email).toBe('simple.new@example.com');
      expect(updatedUser.name).toBe('Simple Key User'); // Other attributes preserved
      expect(updatedUser.id).toBe('simple-1');

      // Verify we can get with new key
      const retrieved = await simpleKeyDdb.get({ 
        id: 'simple-1', 
        email: 'simple.new@example.com' 
      }).execute();
      expect(retrieved).toBeTruthy();
      expect(retrieved?.email).toBe('simple.new@example.com');
      expect(retrieved?.name).toBe('Simple Key User');

      // Verify old item was deleted
      const oldUser = await simpleKeyDdb.get({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      }).execute();
      expect(oldUser).toBeNull();
    });

    it('should handle both key updates through create-and-delete transaction', async () => {
      const updatedUser = await simpleKeyDdb.update({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      })
        .set({ 
          id: 'simple-1-new',
          email: 'simple.new@example.com' 
        })
        .execute();

      expect(updatedUser.id).toBe('simple-1-new');
      expect(updatedUser.email).toBe('simple.new@example.com');
      expect(updatedUser.name).toBe('Simple Key User'); // Other attributes preserved

      // Verify we can get with new keys
      const retrieved = await simpleKeyDdb.get({ 
        id: 'simple-1-new', 
        email: 'simple.new@example.com' 
      }).execute();
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe('simple-1-new');
      expect(retrieved?.email).toBe('simple.new@example.com');
      expect(retrieved?.name).toBe('Simple Key User');

      // Verify old item was deleted
      const oldUser = await simpleKeyDdb.get({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      }).execute();
      expect(oldUser).toBeNull();
    });

    it('should maintain conditional expressions when updating keys', async () => {
      // Update with condition should still work when changing keys
      const updatedUser = await simpleKeyDdb.update({ 
        id: 'simple-1', 
        email: 'simple@example.com' 
      })
        .set({ 
          id: 'simple-1-new',
          email: 'simple.new@example.com' 
        })
        .setCondition('#n = :n', {
          ':n': 'Simple Key User'
        }, {
          '#n': 'name'
        })
        .execute();

      expect(updatedUser.id).toBe('simple-1-new');
      expect(updatedUser.email).toBe('simple.new@example.com');
      expect(updatedUser.name).toBe('Simple Key User');

      // Verify condition fails when it should
      await expect(simpleKeyDdb.update({ 
        id: 'simple-1-new', 
        email: 'simple.new@example.com' 
      })
        .set({ 
          id: 'simple-1-newer',
          name: 'New Name'
        })
        .setCondition('#n = :n', {
          ':n': 'Wrong Name'
        }, {
          '#n': 'name'
        })
        .execute()).rejects.toThrow();
    });
  });

  describe('Complex Key Definitions', () => {
    const complexKeyDdb = new BetterDDB<User>({
      schema: UserSchema,
      tableName: TEST_TABLE,
      entityType: ENTITY_TYPE,
      keys: {
        primary: { 
          name: PRIMARY_KEY, 
          definition: { 
            build: (raw) => `USER#${raw.id}` 
          } 
        },
        sort: { 
          name: SORT_KEY, 
          definition: { 
            build: (raw) => `EMAIL#${raw.email}` 
          } 
        },
        gsis: {
          [GSI_NAME]: {
            name: GSI_NAME,
            primary: { 
              name: GSI_PRIMARY_KEY, 
              definition: { 
                build: (raw) => `EMAIL#${raw.email}` 
              } 
            },
            sort: { 
              name: GSI_SORT_KEY, 
              definition: { 
                build: (raw) => `USER#${raw.id}` 
              } 
            }
          }
        }
      },
      client,
      timestamps: true,
    });

    beforeEach(async () => {
      const user: User = { 
        id: 'complex-1', 
        name: 'Complex Key User', 
        email: 'complex@example.com' 
      };
      await complexKeyDdb.create(user).execute();
    });

    it('should handle key updates with complex definitions through create-and-delete transaction', async () => {
      const updatedUser = await complexKeyDdb.update({ 
        id: 'complex-1', 
        email: 'complex@example.com' 
      })
        .set({ 
          id: 'complex-1-new',
          email: 'complex.new@example.com' 
        })
        .execute();

      expect(updatedUser.id).toBe('complex-1-new');
      expect(updatedUser.email).toBe('complex.new@example.com');
      expect(updatedUser.name).toBe('Complex Key User'); // Other attributes preserved

      // Verify we can get with new keys
      const retrieved = await complexKeyDdb.get({ 
        id: 'complex-1-new', 
        email: 'complex.new@example.com' 
      }).execute();
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe('complex-1-new');
      expect(retrieved?.email).toBe('complex.new@example.com');
      expect(retrieved?.name).toBe('Complex Key User');

      // Verify old item was deleted
      const oldUser = await complexKeyDdb.get({ 
        id: 'complex-1', 
        email: 'complex@example.com' 
      }).execute();
      expect(oldUser).toBeNull();

      // Verify GSI is updated
      const gsiQuery = await complexKeyDdb.query({ email: 'complex.new@example.com' })
        .usingIndex(GSI_NAME)
        .where('==', { id: 'complex-1-new' })
        .execute();
      expect(gsiQuery.items).toHaveLength(1);
      expect(gsiQuery.items[0].id).toBe('complex-1-new');
      expect(gsiQuery.items[0].email).toBe('complex.new@example.com');

      // Verify old GSI keys don't work
      const oldGsiQuery = await complexKeyDdb.query({ email: 'complex@example.com' })
        .usingIndex(GSI_NAME)
        .where('==', { id: 'complex-1' })
        .execute();
      expect(oldGsiQuery.items).toHaveLength(0);
    });

    it('should handle key updates in multi-item transactions', async () => {
      // Create a second user
      const user2: User = { 
        id: 'complex-2', 
        name: 'Complex User 2', 
        email: 'complex2@example.com' 
      };
      await complexKeyDdb.create(user2).execute();

      // Update both users in a transaction, changing their keys
      const secondUpdate = complexKeyDdb.update({ 
        id: 'complex-2', 
        email: 'complex2@example.com' 
      })
        .set({ 
          id: 'complex-2-new',
          email: 'complex2.new@example.com' 
        })
        .toTransactUpdate();

      const updatedUser = await complexKeyDdb.update({ 
        id: 'complex-1', 
        email: 'complex@example.com' 
      })
        .set({ 
          id: 'complex-1-new',
          email: 'complex.new@example.com' 
        })
        .transactWrite(secondUpdate)
        .execute();

      // Verify first user was updated correctly
      expect(updatedUser.id).toBe('complex-1-new');
      expect(updatedUser.email).toBe('complex.new@example.com');
      expect(updatedUser.name).toBe('Complex Key User');

      // Verify both users can be retrieved with new keys
      const user1New = await complexKeyDdb.get({ 
        id: 'complex-1-new', 
        email: 'complex.new@example.com' 
      }).execute();
      expect(user1New).toBeTruthy();
      expect(user1New?.id).toBe('complex-1-new');
      expect(user1New?.name).toBe('Complex Key User');

      const user2New = await complexKeyDdb.get({ 
        id: 'complex-2-new', 
        email: 'complex2.new@example.com' 
      }).execute();
      expect(user2New).toBeTruthy();
      expect(user2New?.id).toBe('complex-2-new');
      expect(user2New?.name).toBe('Complex User 2');

      // Verify old items were deleted
      const user1Old = await complexKeyDdb.get({ 
        id: 'complex-1', 
        email: 'complex@example.com' 
      }).execute();
      expect(user1Old).toBeNull();

      const user2Old = await complexKeyDdb.get({ 
        id: 'complex-2', 
        email: 'complex2@example.com' 
      }).execute();
      expect(user2Old).toBeNull();

      // Verify GSIs are updated
      const gsiQuery1 = await complexKeyDdb.query({ email: 'complex.new@example.com' })
        .usingIndex(GSI_NAME)
        .where('==', { id: 'complex-1-new' })
        .execute();
      expect(gsiQuery1.items).toHaveLength(1);
      expect(gsiQuery1.items[0].id).toBe('complex-1-new');

      const gsiQuery2 = await complexKeyDdb.query({ email: 'complex2.new@example.com' })
        .usingIndex(GSI_NAME)
        .where('==', { id: 'complex-2-new' })
        .execute();
      expect(gsiQuery2.items).toHaveLength(1);
      expect(gsiQuery2.items[0].id).toBe('complex-2-new');
    });
  });
});
